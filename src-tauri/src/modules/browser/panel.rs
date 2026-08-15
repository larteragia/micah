//! Everything that touches a live webview.
//!
//! Split out from `mod.rs` because this is the only part that needs Tauri's
//! `unstable` API (`Window::add_child`, `AppHandle::get_webview`). Behind the
//! `browser-panel` feature, so `--no-default-features` proves the crate still
//! builds on the stable surface — a rollback that is a flag, not a patch.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{LogicalPosition, LogicalSize, Manager, Runtime, State, WebviewUrl};

/// Browser panel min (320) + sidebar min (220) + room for a usable workspace.
const MIN_WINDOW_WIDTH_WITH_PANEL: f64 = 860.0;
/// Matches `minHeight` in tauri.conf.json.
const MIN_WINDOW_HEIGHT: f64 = 280.0;
/// The stock minimum from tauri.conf.json, restored when the panel goes away.
const MIN_WINDOW_WIDTH_PLAIN: f64 = 420.0;

use super::{
    clear_discovery, discovery_path, normalize_url, now_millis, Attached, BrowserInfo,
    BrowserState, CdpInfo, BLANK, CDP_FALLBACK_TIMEOUT, CDP_PROBE_INTERVAL, CDP_PROBE_TIMEOUT,
    PROFILE_DIR, WEBVIEW_LABEL,
};

fn profile_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    let dir = base.join(PROFILE_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Grab a port the OS says is free. Classic TOCTOU — something else can take it
/// between the drop and WebView2's bind — which is why nothing is written to the
/// discovery file until the port has actually answered (see `probe_cdp`).
fn pick_free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("could not reserve a debugging port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("could not read reserved port: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// Chromium writes the real port here when told to listen on 0, and it is also
/// the only trustworthy source when the requested port was taken.
fn devtools_active_port(profile: &std::path::Path) -> Option<u16> {
    let raw = std::fs::read_to_string(profile.join("DevToolsActivePort")).ok()?;
    raw.lines().next()?.trim().parse::<u16>().ok()
}

/// Poll `/json/version` until the port answers. Returns the WebSocket endpoint,
/// which is the only thing Playwright actually needs.
async fn probe_cdp(port: u16, budget: Duration) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let url = format!("http://127.0.0.1:{port}/json/version");

    let deadline = std::time::Instant::now() + budget;
    let mut last = String::from("no response");
    while std::time::Instant::now() < deadline {
        match client.get(&url).send().await {
            // `.text()` then parse, rather than reqwest's `json` feature, which
            // this crate does not enable.
            Ok(response) => match response
                .text()
                .await
                .map_err(|e| e.to_string())
                .and_then(|raw| {
                    serde_json::from_str::<serde_json::Value>(&raw).map_err(|e| e.to_string())
                }) {
                Ok(body) => {
                    if let Some(ws) = body
                        .get("webSocketDebuggerUrl")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    {
                        return Ok(ws.to_string());
                    }
                    last = format!("no webSocketDebuggerUrl in {body}");
                }
                Err(e) => last = format!("bad response: {e}"),
            },
            Err(e) => last = e.to_string(),
        }
        tokio::time::sleep(CDP_PROBE_INTERVAL).await;
    }
    Err(last)
}

fn write_discovery<R: Runtime>(app: &tauri::AppHandle<R>, info: &CdpInfo) -> Result<(), String> {
    let path = discovery_path(app)?;
    let body = serde_json::to_string_pretty(info).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Everything wry disables by default, minus `msSmartScreenProtection`.
///
/// `additional_browser_args` *replaces* wry's defaults rather than appending, so
/// dropping `msWebOOUI`/`msPdfOOUI` would make the panel spawn Edge's own dialogs
/// outside our window. SmartScreen is deliberately left ON: this is the user's
/// real browsing, not a test harness.
///
/// `--remote-allow-origins` is deliberately absent. It only relaxes the `Origin`
/// check on the CDP WebSocket handshake, Playwright doesn't send that header, and
/// `*` would let any web page on the machine seize the panel.
#[cfg(windows)]
fn browser_args(port: u16) -> String {
    format!("--disable-features=msWebOOUI,msPdfOOUI --remote-debugging-port={port}")
}

/// Create the panel as a child webview of the calling window.
///
/// `async` is not decoration: `Window::add_child` posts to the main thread and
/// blocks on the reply, so a synchronous command would deadlock the window.
///
/// The window is taken from the IPC caller, never from a parameter — otherwise
/// any webview with IPC (settings, a second window) could attach or steal the
/// panel belonging to another.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // x/y/width/height are one rectangle; a struct would only rename the eight
pub async fn browser_attach(
    app: tauri::AppHandle,
    caller: tauri::Window,
    state: State<'_, BrowserState>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<BrowserInfo, String> {
    let window_label = caller.label().to_string();

    // Claim the slot *before* the slow work. Creating the webview and probing
    // the debugging port take seconds; leaving the state empty for that long
    // lets a second window walk past this guard and fail deep inside Tauri with
    // a raw duplicate-label error instead of the sentence below.
    {
        let mut guard = state.inner.lock().expect("BrowserState mutex poisoned");
        match guard.as_ref() {
            Some(attached) if attached.window_label == window_label => {
                return Ok(attached.info.clone());
            }
            Some(attached) => {
                return Err(format!(
                    "the browser panel is already attached to window \"{}\"; only one panel exists per process",
                    attached.window_label
                ));
            }
            None => {
                *guard = Some(Attached {
                    window_label: window_label.clone(),
                    info: BrowserInfo::pending(&window_label),
                });
            }
        }
    }

    match attach_inner(&app, &caller, &window_label, &url, x, y, width, height).await {
        Ok(info) => {
            *state.inner.lock().expect("BrowserState mutex poisoned") = Some(Attached {
                window_label,
                info: info.clone(),
            });
            Ok(info)
        }
        Err(e) => {
            // Release the slot, or a transient failure would lock the panel out
            // of every window until the app restarts.
            *state.inner.lock().expect("BrowserState mutex poisoned") = None;
            Err(e)
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn attach_inner(
    app: &tauri::AppHandle,
    caller: &tauri::Window,
    window_label: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<BrowserInfo, String> {
    let target = normalize_url(url).unwrap_or_else(|| BLANK.to_string());
    let parsed = target
        .parse::<tauri::Url>()
        .map_err(|e| format!("bad url {target}: {e}"))?;

    let window = caller.clone();

    #[allow(unused_mut)]
    let mut builder = tauri::webview::WebviewBuilder::new(WEBVIEW_LABEL, WebviewUrl::External(parsed))
        // Keep the panel on the web. `file:`, `javascript:`, `tauri:` and `asset:`
        // would each turn an open debugging port into disk access or, worse, into
        // the app's own IPC origin.
        .on_navigation(|url| {
            matches!(url.scheme(), "http" | "https") || url.as_str() == BLANK
        });

    #[allow(unused_mut, unused_assignments)]
    let mut requested: Option<(u16, PathBuf)> = None;

    #[cfg(windows)]
    {
        let profile = profile_dir(app)?;
        // Chromium's record of the live port survives a crash. Left in place, the
        // fallback below would read *last* session's port and prefer it over the
        // one we are about to ask for.
        let _ = std::fs::remove_file(profile.join("DevToolsActivePort"));
        let port = pick_free_port()?;
        builder = builder
            .additional_browser_args(&browser_args(port))
            // Environment-level opt-in required by AddBrowserExtension. Safe on
            // old runtimes (the option object simply carries a flag they never
            // read), and safe for the app's own webview, which lives in a
            // different data directory and therefore a different environment.
            .browser_extensions_enabled(true)
            .data_directory(profile.clone());
        requested = Some((port, profile));
    }

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|e| format!("could not create the browser webview: {e}"))?;

    // SPA navigations (`history.pushState`) fire none of wry's events; the COM
    // SourceChanged/HistoryChanged pair is the only push-based source. The
    // frontend keeps its URL polling as the cross-platform fallback.
    #[cfg(windows)]
    if let Some(panel_webview) = app.get_webview(WEBVIEW_LABEL) {
        super::com::register_nav_events(&panel_webview, app.clone(), window_label.to_string());
    }

    // With three panels sharing the width, the window's stock 420px minimum is
    // smaller than the sum of what they need — the layout engine then has to
    // violate somebody's minimum. Raised while the panel is up, restored on
    // detach, so turning the feature off does not leave the window fat.
    let _ = window.set_min_size(Some(LogicalSize::new(
        MIN_WINDOW_WIDTH_WITH_PANEL,
        MIN_WINDOW_HEIGHT,
    )));

    let (cdp, cdp_error) = match requested {
        None => (
            None,
            Some(
                "the debugging bridge needs WebView2, so it is Windows-only; the panel itself works"
                    .to_string(),
            ),
        ),
        Some((port, profile)) => match resolve_cdp(port, &profile).await {
            Ok((actual, ws_endpoint)) => {
                let info = CdpInfo {
                    schema: 1,
                    port: actual,
                    ws_endpoint,
                    pid: std::process::id(),
                    started_at: now_millis(),
                    window_label: window_label.to_string(),
                };
                if let Err(e) = write_discovery(app, &info) {
                    log::warn!("browser: could not write the CDP discovery file: {e}");
                }
                (Some(info), None)
            }
            Err(e) => (None, Some(format!("the debugging port never answered: {e}"))),
        },
    };

    Ok(BrowserInfo {
        window_label: window_label.to_string(),
        webview_label: WEBVIEW_LABEL.to_string(),
        cdp,
        cdp_error,
    })
}

/// Find the port the panel is actually listening on.
///
/// The requested port is tried first, because that is the one we asked for. Only
/// if it stays silent is `DevToolsActivePort` consulted — by then Chromium has
/// had time to write it, and since it was deleted before the webview was created,
/// whatever is in it belongs to *this* session.
async fn resolve_cdp(port: u16, profile: &std::path::Path) -> Result<(u16, String), String> {
    match probe_cdp(port, CDP_PROBE_TIMEOUT).await {
        Ok(ws) => Ok((port, ws)),
        Err(first) => match devtools_active_port(profile) {
            Some(actual) if actual != port => probe_cdp(actual, CDP_FALLBACK_TIMEOUT)
                .await
                .map(|ws| (actual, ws))
                .map_err(|second| {
                    format!("port {port}: {first}; recorded port {actual}: {second}")
                }),
            _ => Err(first),
        },
    }
}

#[tauri::command]
pub async fn browser_detach(
    app: tauri::AppHandle,
    state: State<'_, BrowserState>,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(WEBVIEW_LABEL) {
        let _ = webview.window().set_min_size(Some(LogicalSize::new(
            MIN_WINDOW_WIDTH_PLAIN,
            MIN_WINDOW_HEIGHT,
        )));
        let _ = webview.close();
    }
    *state.inner.lock().expect("BrowserState mutex poisoned") = None;
    clear_discovery(&app);
    Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the browser panel is not attached".to_string())?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
        .map_err(|e| e.to_string())
}

/// Hidden, not resized to nothing: a zero-size webview keeps painting a sliver on
/// Windows, and the agent needs to be able to tell "suppressed" from "gone".
#[tauri::command]
pub async fn browser_set_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let webview = app
        .get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the browser panel is not attached".to_string())?;
    if visible {
        webview.show().map_err(|e| e.to_string())
    } else {
        webview.hide().map_err(|e| e.to_string())
    }
}

/// Returns the URL actually navigated to, or `None` when the input was empty or
/// refused — a no-op, not an error, so an accidental Enter on a blank field does
/// not paint a failure at the user.
#[tauri::command]
pub async fn browser_navigate(
    app: tauri::AppHandle,
    url: String,
) -> Result<Option<String>, String> {
    let Some(target) = normalize_url(&url) else {
        return Ok(None);
    };
    let parsed = target
        .parse::<tauri::Url>()
        .map_err(|e| format!("bad url {target}: {e}"))?;
    let webview = app
        .get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the browser panel is not attached".to_string())?;
    webview.navigate(parsed).map_err(|e| e.to_string())?;
    Ok(Some(target))
}

#[tauri::command]
pub async fn browser_go(app: tauri::AppHandle, delta: i32) -> Result<(), String> {
    let webview = app
        .get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the browser panel is not attached".to_string())?;
    webview
        .eval(format!("history.go({delta})"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_reload(app: tauri::AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the browser panel is not attached".to_string())?;
    webview.reload().map_err(|e| e.to_string())
}

/// Polled by the frontend. `on_navigation`/`on_page_load` both miss
/// `history.pushState`, which is how every SPA navigates — so the address bar
/// reads the webview's current URL instead of trusting events.
#[tauri::command]
pub async fn browser_url(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(webview) = app.get_webview(WEBVIEW_LABEL) else {
        return Ok(None);
    };
    Ok(webview.url().ok().map(|u| u.to_string()))
}

#[tauri::command]
pub async fn browser_cdp(state: State<'_, BrowserState>) -> Result<Option<CdpInfo>, String> {
    let guard = state.inner.lock().expect("BrowserState mutex poisoned");
    Ok(guard.as_ref().and_then(|a| a.info.cdp.clone()))
}

/// URL + title + favicon in one COM trip, for the bookmark-add flow: reading
/// them separately lets a fast navigation pair one page's URL with another
/// page's icon.
#[tauri::command]
pub async fn browser_page_info(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    {
        let info = super::com::page_info(app).await?;
        serde_json::to_value(info).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let webview = app
            .get_webview(WEBVIEW_LABEL)
            .ok_or_else(|| "the browser panel is not attached".to_string())?;
        Ok(serde_json::json!({
            "url": webview.url().ok().map(|u| u.to_string()),
            "title": null,
            "favicon_png_base64": null,
        }))
    }
}

#[tauri::command]
pub async fn browser_extensions_list(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    {
        let list = super::com::extensions_list(app).await?;
        serde_json::to_value(list).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("browser extensions need WebView2, so they are Windows-only".to_string())
    }
}

#[tauri::command]
pub async fn browser_extension_add(
    app: tauri::AppHandle,
    path: String,
) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    {
        let info = super::com::extension_add(app, path).await?;
        serde_json::to_value(info).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, path);
        Err("browser extensions need WebView2, so they are Windows-only".to_string())
    }
}

#[tauri::command]
pub async fn browser_extension_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        super::com::extension_remove(app, id).await
    }
    #[cfg(not(windows))]
    {
        let _ = (app, id);
        Err("browser extensions need WebView2, so they are Windows-only".to_string())
    }
}

/// Clears inside the panel's own profile via `ClearBrowsingData` — the profile
/// directory is never deleted, so the CDP port and out-of-scope logins survive,
/// and the app UI's own storage is a different profile entirely.
#[tauri::command]
pub async fn browser_clear_data(app: tauri::AppHandle, kinds: Vec<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        super::com::clear_browsing_data(app, kinds).await
    }
    #[cfg(not(windows))]
    {
        let _ = (app, kinds);
        Err("clearing browsing data needs WebView2, so it is Windows-only".to_string())
    }
}
