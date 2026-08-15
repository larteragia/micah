//! Raw WebView2 COM access for the browser panel: navigation events, favicon,
//! extensions and browsing-data clearing.
//!
//! These interfaces are not surfaced by wry or tauri, and the crates were
//! already compiled into the binary through wry — declaring them as direct
//! dependencies adds no bytes and no new technology (decision recorded in the
//! browser PDI card). Every COM call runs inside `Webview::with_webview`, which
//! posts to the UI thread; results come back over an mpsc channel with a
//! timeout, the same bridge shape the control and lsp modules already use.
//!
//! Every interface cast is `if let Ok`/`map_err`, never a bare `?` on the
//! creation path: an older WebView2 runtime lacking an interface must degrade
//! that feature, not kill the panel.

use std::sync::mpsc;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::{Emitter, Manager};
use webview2_com::take_pwstr;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2BrowserExtension, ICoreWebView2Profile2, ICoreWebView2Profile7,
    ICoreWebView2_13, ICoreWebView2_15, COREWEBVIEW2_BROWSING_DATA_KINDS,
    COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE, COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
    COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    COREWEBVIEW2_BROWSING_DATA_KINDS_DOWNLOAD_HISTORY,
    COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL,
    COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY,
    COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
    COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG,
};
use webview2_com::{
    ClearBrowsingDataCompletedHandler, DocumentTitleChangedEventHandler,
    GetFaviconCompletedHandler, HistoryChangedEventHandler,
    ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
    BrowserExtensionRemoveCompletedHandler, SourceChangedEventHandler,
};
use windows::core::{Interface, BOOL, PCWSTR, PWSTR};
use windows::Win32::System::Com::IStream;

use super::WEBVIEW_LABEL;

/// How long a COM round-trip may take before the command gives up. Attach can
/// legitimately be slow; reading a favicon or listing extensions cannot.
const COM_TIMEOUT: Duration = Duration::from_secs(5);

type EventRegistrationToken = i64;

#[derive(Clone, Serialize)]
pub struct NavEvent {
    pub url: String,
}

#[derive(Clone, Serialize)]
pub struct TitleEvent {
    pub url: String,
    pub title: String,
}

#[derive(Clone, Serialize)]
pub struct PageInfo {
    pub url: Option<String>,
    pub title: Option<String>,
    /// PNG bytes, base64. `None` when the page declares no favicon or the
    /// runtime predates `ICoreWebView2_15` — the caller falls back to a
    /// deterministic letter tile, never blocks the add.
    pub favicon_png_base64: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub enabled: bool,
}

fn current_source(webview: &ICoreWebView2) -> Option<String> {
    let mut source = PWSTR::null();
    unsafe { webview.Source(&mut source) }.ok()?;
    let url = take_pwstr(source);
    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

/// Register SourceChanged + HistoryChanged + DocumentTitleChanged on the panel
/// webview, forwarding them to the main window as `micah:browser-nav` and
/// `micah:browser-title`. Both nav events fire for one `pushState`; the
/// frontend history reducer dedupes, so this stays a dumb pipe.
///
/// Tokens are dropped on purpose: the handlers live exactly as long as the
/// webview, and the webview only dies with the panel.
pub fn register_nav_events(webview: &tauri::Webview, app: tauri::AppHandle, owner_label: String) {
    let result = webview.with_webview(move |platform| {
        let core = match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(e) => {
                log::warn!("browser: no CoreWebView2 for event registration: {e}");
                return;
            }
        };
        let mut token = EventRegistrationToken::default();

        let nav_app = app.clone();
        let nav_label = owner_label.clone();
        let source_handler = SourceChangedEventHandler::create(Box::new(move |webview, _| {
            if let Some(webview) = webview {
                if let Some(url) = current_source(&webview) {
                    let _ =
                        nav_app.emit_to(nav_label.as_str(), "micah:browser-nav", NavEvent { url });
                }
            }
            Ok(())
        }));
        if let Err(e) = unsafe { core.add_SourceChanged(&source_handler, &mut token) } {
            log::warn!("browser: SourceChanged registration failed: {e}");
        }

        let hist_app = app.clone();
        let hist_label = owner_label.clone();
        let history_handler = HistoryChangedEventHandler::create(Box::new(move |webview, _| {
            if let Some(webview) = webview {
                if let Some(url) = current_source(&webview) {
                    let _ =
                        hist_app.emit_to(hist_label.as_str(), "micah:browser-nav", NavEvent { url });
                }
            }
            Ok(())
        }));
        if let Err(e) = unsafe { core.add_HistoryChanged(&history_handler, &mut token) } {
            log::warn!("browser: HistoryChanged registration failed: {e}");
        }

        let title_app = app;
        let title_label = owner_label;
        let title_handler = DocumentTitleChangedEventHandler::create(Box::new(move |webview, _| {
            if let Some(webview) = webview {
                let mut title = PWSTR::null();
                if unsafe { webview.DocumentTitle(&mut title) }.is_ok() {
                    let title = take_pwstr(title);
                    if let Some(url) = current_source(&webview) {
                        let _ = title_app.emit_to(
                            title_label.as_str(),
                            "micah:browser-title",
                            TitleEvent { url, title },
                        );
                    }
                }
            }
            Ok(())
        }));
        if let Err(e) = unsafe { core.add_DocumentTitleChanged(&title_handler, &mut token) } {
            log::warn!("browser: DocumentTitleChanged registration failed: {e}");
        }
    });
    if let Err(e) = result {
        log::warn!("browser: could not reach the webview for event registration: {e}");
    }
}

fn read_stream(stream: &IStream) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let mut read = 0u32;
        let hr = unsafe {
            stream.Read(
                buf.as_mut_ptr() as *mut _,
                buf.len() as u32,
                Some(&mut read),
            )
        };
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..read as usize]);
        if hr.is_err() {
            break;
        }
    }
    bytes
}

fn panel_webview(app: &tauri::AppHandle) -> Result<tauri::Webview, String> {
    app.get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the browser panel is not attached".to_string())
}

async fn recv<T: Send + 'static>(rx: mpsc::Receiver<Result<T, String>>) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(COM_TIMEOUT))
        .await
        .map_err(|e| format!("bridge task failed: {e}"))?
        .map_err(|_| "the webview did not answer in time".to_string())?
}

/// URL, title and favicon read in ONE trip, so a bookmark saved right after a
/// fast navigation cannot pair the old page's URL with the new page's icon.
pub async fn page_info(app: tauri::AppHandle) -> Result<PageInfo, String> {
    let webview = panel_webview(&app)?;
    let (tx, rx) = mpsc::channel::<Result<PageInfo, String>>();

    webview
        .with_webview(move |platform| {
            let core = match unsafe { platform.controller().CoreWebView2() } {
                Ok(core) => core,
                Err(e) => {
                    let _ = tx.send(Err(format!("no CoreWebView2: {e}")));
                    return;
                }
            };
            let url = current_source(&core);
            let mut title = PWSTR::null();
            let title = unsafe { core.DocumentTitle(&mut title) }
                .ok()
                .map(|_| take_pwstr(title))
                .filter(|t| !t.is_empty());

            let Ok(wv15) = core.cast::<ICoreWebView2_15>() else {
                // Runtime predates GetFavicon (1.0.1293): degrade, never fail.
                let _ = tx.send(Ok(PageInfo {
                    url,
                    title,
                    favicon_png_base64: None,
                }));
                return;
            };

            let done = tx.clone();
            let handler = GetFaviconCompletedHandler::create(Box::new(move |hr, stream| {
                let icon = match (hr, stream) {
                    (Ok(()), Some(stream)) => {
                        let bytes = read_stream(&stream);
                        if bytes.is_empty() {
                            None
                        } else {
                            Some(base64::engine::general_purpose::STANDARD.encode(bytes))
                        }
                    }
                    _ => None,
                };
                let _ = done.send(Ok(PageInfo {
                    url: url.clone(),
                    title: title.clone(),
                    favicon_png_base64: icon,
                }));
                Ok(())
            }));
            if let Err(e) =
                unsafe { wv15.GetFavicon(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG, &handler) }
            {
                let _ = tx.send(Err(format!("GetFavicon: {e}")));
            }
        })
        .map_err(|e| e.to_string())?;

    recv(rx).await
}

fn profile7(core: &ICoreWebView2) -> Result<ICoreWebView2Profile7, String> {
    let wv13 = core
        .cast::<ICoreWebView2_13>()
        .map_err(|e| format!("this WebView2 runtime has no profile API: {e}"))?;
    let profile = unsafe { wv13.Profile() }.map_err(|e| format!("no profile: {e}"))?;
    profile.cast::<ICoreWebView2Profile7>().map_err(|e| {
        format!("this WebView2 runtime predates browser extensions (needs 120.0.2210.55+): {e}")
    })
}

fn extension_info(ext: &ICoreWebView2BrowserExtension) -> Option<ExtensionInfo> {
    let mut id = PWSTR::null();
    unsafe { ext.Id(&mut id) }.ok()?;
    let mut name = PWSTR::null();
    unsafe { ext.Name(&mut name) }.ok()?;
    let mut enabled = BOOL::default();
    unsafe { ext.IsEnabled(&mut enabled) }.ok()?;
    Some(ExtensionInfo {
        id: take_pwstr(id),
        name: take_pwstr(name),
        enabled: enabled.as_bool(),
    })
}

pub async fn extensions_list(app: tauri::AppHandle) -> Result<Vec<ExtensionInfo>, String> {
    let webview = panel_webview(&app)?;
    let (tx, rx) = mpsc::channel::<Result<Vec<ExtensionInfo>, String>>();

    webview
        .with_webview(move |platform| {
            let run = || -> Result<(), String> {
                let core = unsafe { platform.controller().CoreWebView2() }
                    .map_err(|e| format!("no CoreWebView2: {e}"))?;
                let profile = profile7(&core)?;
                let done = tx.clone();
                let handler =
                    ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |hr, list| {
                        let result = match (hr, list) {
                            (Ok(()), Some(list)) => {
                                let mut out = Vec::new();
                                let mut count = 0u32;
                                if unsafe { list.Count(&mut count) }.is_ok() {
                                    for i in 0..count {
                                        if let Ok(ext) = unsafe { list.GetValueAtIndex(i) } {
                                            if let Some(info) = extension_info(&ext) {
                                                out.push(info);
                                            }
                                        }
                                    }
                                }
                                Ok(out)
                            }
                            (Err(e), _) => Err(format!("GetBrowserExtensions: {e}")),
                            _ => Ok(Vec::new()),
                        };
                        let _ = done.send(result);
                        Ok(())
                    }));
                unsafe { profile.GetBrowserExtensions(&handler) }
                    .map_err(|e| format!("GetBrowserExtensions: {e}"))
            };
            if let Err(e) = run() {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;

    recv(rx).await
}

/// A folder is only handed to WebView2 after this: an unpacked extension is a
/// directory whose root holds a manifest.json. Anything else makes
/// `AddBrowserExtension` fail — and inside webview creation (the wry path) a
/// failure there kills the whole panel, which is why the runtime path exists.
pub fn validate_extension_dir(path: &std::path::Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{} is not a directory", path.display()));
    }
    if !path.join("manifest.json").is_file() {
        return Err(format!(
            "{} has no manifest.json at its root; point at the unpacked extension folder itself",
            path.display()
        ));
    }
    Ok(())
}

pub async fn extension_add(app: tauri::AppHandle, path: String) -> Result<ExtensionInfo, String> {
    let dir = std::path::PathBuf::from(&path);
    validate_extension_dir(&dir)?;
    let webview = panel_webview(&app)?;
    let (tx, rx) = mpsc::channel::<Result<ExtensionInfo, String>>();

    webview
        .with_webview(move |platform| {
            let run = || -> Result<(), String> {
                let core = unsafe { platform.controller().CoreWebView2() }
                    .map_err(|e| format!("no CoreWebView2: {e}"))?;
                let profile = profile7(&core)?;
                let done = tx.clone();
                let handler =
                    ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |hr, ext| {
                        let result = match (hr, ext) {
                            (Ok(()), Some(ext)) => extension_info(&ext)
                                .ok_or_else(|| "extension loaded but unreadable".to_string()),
                            (Err(e), _) => Err(format!("AddBrowserExtension: {e}")),
                            _ => Err("AddBrowserExtension returned nothing".to_string()),
                        };
                        let _ = done.send(result);
                        Ok(())
                    }));
                let wide: Vec<u16> = dir
                    .as_os_str()
                    .to_string_lossy()
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                unsafe { profile.AddBrowserExtension(PCWSTR(wide.as_ptr()), &handler) }
                    .map_err(|e| format!("AddBrowserExtension: {e}"))
            };
            if let Err(e) = run() {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;

    recv(rx).await
}

pub async fn extension_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let webview = panel_webview(&app)?;
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    webview
        .with_webview(move |platform| {
            let run = || -> Result<(), String> {
                let core = unsafe { platform.controller().CoreWebView2() }
                    .map_err(|e| format!("no CoreWebView2: {e}"))?;
                let profile = profile7(&core)?;
                let done = tx.clone();
                let want = id.clone();
                let outer = tx.clone();
                let handler =
                    ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |hr, list| {
                        let run = || -> Result<(), String> {
                            let list = match (hr, list) {
                                (Ok(()), Some(list)) => list,
                                (Err(e), _) => return Err(format!("GetBrowserExtensions: {e}")),
                                _ => return Err("no extension list".to_string()),
                            };
                            let mut count = 0u32;
                            unsafe { list.Count(&mut count) }
                                .map_err(|e| format!("Count: {e}"))?;
                            for i in 0..count {
                                let Ok(ext) = (unsafe { list.GetValueAtIndex(i) }) else {
                                    continue;
                                };
                                let Some(info) = extension_info(&ext) else {
                                    continue;
                                };
                                if info.id == want {
                                    let finished = done.clone();
                                    let remove_handler =
                                        BrowserExtensionRemoveCompletedHandler::create(Box::new(
                                            move |hr| {
                                                let _ = finished.send(
                                                    hr.map_err(|e| format!("Remove: {e}")),
                                                );
                                                Ok(())
                                            },
                                        ));
                                    return unsafe { ext.Remove(&remove_handler) }
                                        .map_err(|e| format!("Remove: {e}"));
                                }
                            }
                            Err(format!("no extension with id {want}"))
                        };
                        if let Err(e) = run() {
                            let _ = outer.send(Err(e));
                        }
                        Ok(())
                    }));
                unsafe { profile.GetBrowserExtensions(&handler) }
                    .map_err(|e| format!("GetBrowserExtensions: {e}"))
            };
            if let Err(e) = run() {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;

    recv(rx).await
}

/// The scopes the Limpar dados dialog offers, by name, so the frontend can
/// enumerate exactly what will be lost. Unknown names are an error, not a
/// silent skip — a typo must not quietly clear less than the user confirmed.
pub fn kinds_from_names(names: &[String]) -> Result<COREWEBVIEW2_BROWSING_DATA_KINDS, String> {
    let mut bits = 0i32;
    for name in names {
        let kind = match name.as_str() {
            "cookies" => COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES,
            "cache" => COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
            "cache_storage" => COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
            "dom_storage" => COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE,
            "history" => COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY,
            "downloads" => COREWEBVIEW2_BROWSING_DATA_KINDS_DOWNLOAD_HISTORY,
            "autofill" => COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL,
            "passwords" => COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
            other => return Err(format!("unknown browsing-data kind: {other}")),
        };
        bits |= kind.0;
    }
    if bits == 0 {
        return Err("nothing selected to clear".to_string());
    }
    Ok(COREWEBVIEW2_BROWSING_DATA_KINDS(bits))
}

/// Scoped to the panel's own profile. Never touches the app UI's storage and
/// never deletes the profile directory, so logins outside the cleared scopes
/// and the CDP port both survive.
pub async fn clear_browsing_data(app: tauri::AppHandle, names: Vec<String>) -> Result<(), String> {
    let kinds = kinds_from_names(&names)?;
    let webview = panel_webview(&app)?;
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    webview
        .with_webview(move |platform| {
            let run = || -> Result<(), String> {
                let core = unsafe { platform.controller().CoreWebView2() }
                    .map_err(|e| format!("no CoreWebView2: {e}"))?;
                let wv13 = core
                    .cast::<ICoreWebView2_13>()
                    .map_err(|e| format!("no profile API: {e}"))?;
                let profile = unsafe { wv13.Profile() }.map_err(|e| format!("no profile: {e}"))?;
                let profile2 = profile
                    .cast::<ICoreWebView2Profile2>()
                    .map_err(|e| format!("this runtime cannot clear browsing data: {e}"))?;
                let done = tx.clone();
                let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |hr| {
                    let _ = done.send(hr.map_err(|e| format!("ClearBrowsingData: {e}")));
                    Ok(())
                }));
                unsafe { profile2.ClearBrowsingData(kinds, &handler) }
                    .map_err(|e| format!("ClearBrowsingData: {e}"))
            };
            if let Err(e) = run() {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;

    recv(rx).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_maps_names_and_rejects_junk() {
        let ok = kinds_from_names(&["cookies".into(), "cache".into()]).unwrap();
        assert_eq!(
            ok.0,
            COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES.0
                | COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE.0
        );
        assert!(kinds_from_names(&["cookies".into(), "typo".into()]).is_err());
        assert!(kinds_from_names(&[]).is_err());
    }

    #[test]
    fn extension_dir_validation() {
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_extension_dir(dir.path()).is_err()); // no manifest
        std::fs::write(dir.path().join("manifest.json"), "{}").unwrap();
        assert!(validate_extension_dir(dir.path()).is_ok());
        assert!(validate_extension_dir(&dir.path().join("missing")).is_err());
    }
}
