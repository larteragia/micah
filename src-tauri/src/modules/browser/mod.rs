//! The embedded browser panel.
//!
//! A real Chromium (WebView2 on Windows) living as a *child webview* of the main
//! window — not an `<iframe>`, so `X-Frame-Options` and `frame-ancestors` don't
//! apply and sessions persist. It runs with `--remote-debugging-port`, which is
//! what lets Playwright drive the very browser the human is looking at.
//!
//! Two rules shape everything here:
//!
//! 1. **One panel per process.** WebView2 refuses to create two environments with
//!    different `additional_browser_args` over the same user-data folder, and the
//!    CDP discovery file holds a single port. A second window asking for the panel
//!    gets a legible error, never a silent half-attach.
//! 2. **The panel's data directory is its own.** Tauri requires it once the browser
//!    args differ, and Windows gives one browser *process* per user-data folder —
//!    so the debugging port reaches the panel and never the app's own UI webview.
//!
//! Failure here is never fatal: if the webview or the CDP bridge can't come up,
//! the app still runs and the frontend is told why.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, Runtime};

// Everything that touches a live webview needs Tauri's `unstable` API, so it
// lives behind a feature. `--no-default-features` then builds a binary with the
// commands still present and answering "compiled out" — a rollback that does not
// touch a single call site.
#[cfg(feature = "browser-panel")]
pub mod panel;
#[cfg(not(feature = "browser-panel"))]
pub mod stub;

// Raw WebView2 COM (favicon, nav events, extensions, clear data). Windows-only
// by nature; the panel commands degrade gracefully elsewhere.
#[cfg(all(windows, feature = "browser-panel"))]
pub mod com;

/// The active implementation. `generate_handler!` resolves the macros each
/// `#[tauri::command]` generates alongside the function, so the call sites name
/// this alias rather than the feature-specific module.
#[cfg(feature = "browser-panel")]
pub use panel as commands;
#[cfg(not(feature = "browser-panel"))]
pub use stub as commands;

/// The child webview's label. Deliberately absent from every capability file:
/// the panel must not reach the app's IPC even if a page navigates to a local
/// origin.
const WEBVIEW_LABEL: &str = "browser";

/// Folder under the app data dir holding the panel's Chromium profile. Distinct
/// from the app's own `EBWebView`, on purpose (see module docs).
const PROFILE_DIR: &str = "browser-profile";

/// Discovery file the agent side reads to find the CDP port.
const DISCOVERY_FILE: &str = "browser-cdp.json";

/// How long to wait for the debugging port to answer before declaring the bridge
/// unavailable. The panel itself stays usable either way.
const CDP_PROBE_TIMEOUT: Duration = Duration::from_secs(8);
/// The fallback port comes from Chromium's own record, so it is either right
/// immediately or wrong; no point waiting the full timeout twice.
const CDP_FALLBACK_TIMEOUT: Duration = Duration::from_secs(3);
const CDP_PROBE_INTERVAL: Duration = Duration::from_millis(150);

/// The only non-http page the panel may sit on.
const BLANK: &str = "about:blank";

/// Where a bare search term goes. Typing prose in an address bar is a search,
/// not a hostname, and `https://what is a foo` is not a URL.
const SEARCH_PREFIX: &str = "https://search.brave.com/search?q=";

#[derive(Debug, Clone, Serialize)]
pub struct CdpInfo {
    pub schema: u32,
    pub port: u16,
    pub ws_endpoint: String,
    pub pid: u32,
    /// Milliseconds since the unix epoch. Consumers use it to spot a stale file
    /// left behind by a crash.
    pub started_at: u128,
    pub window_label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserInfo {
    pub window_label: String,
    pub webview_label: String,
    /// `None` when the panel is up but the debugging bridge is not — the reason
    /// is in `cdp_error`.
    pub cdp: Option<CdpInfo>,
    pub cdp_error: Option<String>,
}

impl BrowserInfo {
    /// Placeholder written while the webview is being created, so the slot is
    /// claimed before the slow work rather than after it.
    fn pending(window_label: &str) -> Self {
        Self {
            window_label: window_label.to_string(),
            webview_label: WEBVIEW_LABEL.to_string(),
            cdp: None,
            cdp_error: Some("attaching…".to_string()),
        }
    }
}

struct Attached {
    window_label: String,
    info: BrowserInfo,
}

#[derive(Default)]
pub struct BrowserState {
    inner: Mutex<Option<Attached>>,
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn discovery_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    std::fs::create_dir_all(&base).map_err(|e| format!("create {}: {e}", base.display()))?;
    Ok(base.join(DISCOVERY_FILE))
}

pub fn clear_discovery<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(path) = discovery_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub async fn browser_build_id() -> &'static str {
    env!("MICAH_BUILD_ID")
}

/// Drop the panel's claim when its window is destroyed by the OS.
///
/// Nothing in the frontend runs then, so without this the state keeps naming a
/// window that no longer exists and every future window is told the panel is
/// taken — until the app restarts.
pub fn forget_window(state: &BrowserState, label: &str) -> bool {
    let mut guard = state.inner.lock().expect("BrowserState mutex poisoned");
    let matches = guard
        .as_ref()
        .is_some_and(|attached| attached.window_label == label);
    if matches {
        *guard = None;
    }
    matches
}

/// Turn whatever a human typed into something safe to navigate to, or `None`
/// when there is nothing to do.
///
/// Three outcomes, in order: a URL is kept, a hostname gets `https://`, and
/// anything else is searched for. Refusal is reserved for inputs that *parse* as
/// a URL with a scheme we will not follow — `file:`, `javascript:`, `data:`,
/// `asset:`, `tauri:` — because an open debugging port must never be pointed at
/// the disk or at the app's own origin.
///
/// Kept free of I/O so it can be unit tested.
pub fn normalize_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == BLANK {
        return Some(trimmed.to_string());
    }

    // 1. Written as http(s)? Then it either parses into something with a host,
    //    or there is nothing to navigate to. Never searched: a typo'd URL should
    //    say so, not silently become a web search.
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return trimmed
            .parse::<tauri::Url>()
            .ok()
            .filter(tauri::Url::has_host)
            .map(|_| trimmed.to_string());
    }

    // 2. `host:port` parses as a URL whose "scheme" is the hostname, so it has to
    //    be recognised before the scheme check below refuses it.
    if is_host_port(trimmed) || looks_like_host(trimmed) {
        let candidate = format!("https://{trimmed}");
        if candidate
            .parse::<tauri::Url>()
            .is_ok_and(|u| u.has_host())
        {
            return Some(candidate);
        }
    }

    // 3. Anything else that parses with a scheme is a scheme we will not follow.
    //    This is where `javascript:`, `file:`, `data:`, `about:config`,
    //    `mailto:` and `vbscript:` stop — none of them contain "://", which is
    //    why a substring check was never enough.
    if trimmed.parse::<tauri::Url>().is_ok() {
        return None;
    }

    // 4. Prose. The address bar says "Search or type a URL" and means it.
    Some(format!("{SEARCH_PREFIX}{}", percent_encode_query(trimmed)))
}

/// `example.com:8080/path`, `localhost:1420` — a host and a numeric port, which
/// `Url` would otherwise read as an exotic scheme.
fn is_host_port(input: &str) -> bool {
    let Some((host, rest)) = input.split_once(':') else {
        return false;
    };
    if host.is_empty() || host.contains(char::is_whitespace) {
        return false;
    }
    let port = rest.split(['/', '?', '#']).next().unwrap_or("");
    !port.is_empty()
        && port.chars().all(|c| c.is_ascii_digit())
        && (host.eq_ignore_ascii_case("localhost") || host.contains('.'))
}

/// A hostname has no spaces and either a dot or is a known local name.
fn looks_like_host(input: &str) -> bool {
    if input.contains(char::is_whitespace) || input.contains(':') {
        return false;
    }
    let authority = input.split(['/', '?', '#']).next().unwrap_or(input);
    if authority.is_empty() {
        return false;
    }
    authority.eq_ignore_ascii_case("localhost")
        || (authority.contains('.') && !authority.starts_with('.') && !authority.ends_with('.'))
}

/// Minimal `application/x-www-form-urlencoded` escaping for the search query.
fn percent_encode_query(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{is_host_port, looks_like_host, normalize_url, percent_encode_query, BLANK};

    #[test]
    fn empty_and_blank_input_navigates_nowhere() {
        assert_eq!(normalize_url(""), None);
        assert_eq!(normalize_url("   "), None);
        assert_eq!(normalize_url("\t\n"), None);
    }

    #[test]
    fn bare_host_gets_https() {
        assert_eq!(
            normalize_url("example.com"),
            Some("https://example.com".to_string())
        );
        assert_eq!(
            normalize_url("  example.com/a?b=c  "),
            Some("https://example.com/a?b=c".to_string())
        );
        assert_eq!(
            normalize_url("localhost:1420"),
            Some("https://localhost:1420".to_string())
        );
    }

    #[test]
    fn http_and_https_pass_through_untouched() {
        assert_eq!(
            normalize_url("http://127.0.0.1:1420"),
            Some("http://127.0.0.1:1420".to_string())
        );
        assert_eq!(
            normalize_url("HTTPS://Example.COM/Path"),
            Some("HTTPS://Example.COM/Path".to_string())
        );
    }

    // A URL carrying "://" inside its query used to be refused outright.
    #[test]
    fn a_url_inside_a_query_string_still_navigates() {
        assert_eq!(
            normalize_url("https://google.com/search?q=a://b"),
            Some("https://google.com/search?q=a://b".to_string())
        );
    }

    #[test]
    fn dangerous_schemes_are_refused_not_rewritten() {
        assert_eq!(normalize_url("file:///C:/Windows/win.ini"), None);
        assert_eq!(normalize_url("javascript:alert(1)"), None);
        assert_eq!(normalize_url("JavaScript:alert(1)"), None);
        assert_eq!(normalize_url("data:text/html,<h1>x"), None);
        assert_eq!(normalize_url("asset://localhost/etc/passwd"), None);
        assert_eq!(normalize_url("tauri://localhost"), None);
        // No "://" in any of these — the old substring check missed them all.
        assert_eq!(normalize_url("about:config"), None);
        assert_eq!(normalize_url("chrome:version"), None);
        assert_eq!(normalize_url("vbscript:msgbox(1)"), None);
        assert_eq!(normalize_url("mailto:someone@example.com"), None);
    }

    #[test]
    fn scheme_with_empty_host_is_refused() {
        assert_eq!(normalize_url("http://"), None);
        assert_eq!(normalize_url("https://"), None);
    }

    #[test]
    fn about_blank_is_the_one_allowed_non_http_target() {
        assert_eq!(normalize_url(BLANK), Some(BLANK.to_string()));
    }

    // The placeholder says "Search or type a URL", so prose has to search.
    #[test]
    fn prose_becomes_a_search_instead_of_a_broken_host() {
        assert_eq!(
            normalize_url("how do I embed a webview"),
            Some("https://search.brave.com/search?q=how+do+I+embed+a+webview".to_string())
        );
        assert_eq!(
            normalize_url("rust"),
            Some("https://search.brave.com/search?q=rust".to_string())
        );
    }

    #[test]
    fn search_terms_are_escaped() {
        assert_eq!(percent_encode_query("a b&c=d"), "a+b%26c%3Dd");
        assert_eq!(percent_encode_query("acentuação"), "acentua%C3%A7%C3%A3o");
        assert_eq!(percent_encode_query("safe-._~"), "safe-._~");
    }

    #[test]
    fn host_detection_separates_addresses_from_prose() {
        assert!(looks_like_host("example.com"));
        assert!(looks_like_host("sub.example.co.uk/path"));
        assert!(looks_like_host("localhost"));
        assert!(!looks_like_host("two words"));
        assert!(!looks_like_host("rust"));
        assert!(!looks_like_host(""));
    }

    // `localhost:1420` parses as a URL whose scheme is "localhost"; without this
    // it would be refused as an unknown scheme.
    #[test]
    fn host_and_port_is_not_mistaken_for_a_scheme() {
        assert!(is_host_port("localhost:1420"));
        assert!(is_host_port("example.com:8080/path"));
        assert!(!is_host_port("mailto:someone@example.com"));
        assert!(!is_host_port("about:config"));
        assert!(!is_host_port("javascript:alert(1)"));
        assert!(!is_host_port("example.com"));
    }
}
