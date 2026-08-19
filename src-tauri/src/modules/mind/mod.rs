//! Micah's Mind: the real mindwalk running as a supervised sidecar, shown in
//! a child webview.
//!
//! Two halves share one state. The sidecar half spawns the bundled `mindwalk`
//! binary (`serve --no-open --claude-dir ...`), reads the port it announces
//! on stdout (the only truth, since `--port 0` lets the OS pick), keeps it
//! alive with capped exponential-backoff restarts, and takes it down with the
//! app: an explicit kill on the exit events plus, on Windows, a Job Object
//! with KILL_ON_JOB_CLOSE so even a dirty death of micah reaps the server.
//! The webview half hosts mindwalk's own UI as a child webview of the calling
//! window, mirroring the browser panel: claim-early singleton, async attach,
//! hidden-never-zeroed, navigation locked to the sidecar's loopback origin
//! with the port read live from shared state because a restart moves the
//! server.
//!
//! The webview needs Tauri's `unstable` API, so the real implementation sits
//! behind the `browser-panel` feature and `--no-default-features` builds the
//! stubs, same rollback story as the browser panel.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use shared_child::SharedChild;

#[cfg(feature = "browser-panel")]
pub mod live;
#[cfg(not(feature = "browser-panel"))]
pub mod stub;

#[cfg(feature = "browser-panel")]
pub use live as commands;
#[cfg(not(feature = "browser-panel"))]
pub use stub as commands;

/// The child webview's label. Deliberately absent from every capability file:
/// mindwalk's UI must not reach the app's IPC even though it is served from
/// localhost.
pub const WEBVIEW_LABEL: &str = "mind";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MindLifecycle {
    Off,
    Starting,
    Ready,
    Dead,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindStatus {
    pub state: MindLifecycle,
    pub port: Option<u16>,
    pub restarts: u32,
    pub last_error: Option<String>,
}

pub struct MindState {
    inner: Mutex<Inner>,
    /// The live server's port; 0 = none. An Arc so the webview's navigation
    /// filter always reads the current value: a restart moves the server and
    /// a closure that captured the old port would brick the panel.
    port: Arc<AtomicU16>,
    /// Raised once at app exit. Supervisors and boots in flight stand down
    /// instead of restarting a server the app is abandoning, and their
    /// deaths stop counting as crashes.
    shutdown: Arc<AtomicBool>,
}

struct Inner {
    state: MindLifecycle,
    restarts: u32,
    last_error: Option<String>,
    child: Option<Arc<SharedChild>>,
    #[cfg(windows)]
    job: Option<crate::modules::proc::job::ProcessJob>,
    /// Bumped by every fresh mind_ensure claim; a supervisor holding a stale
    /// generation exits silently instead of fighting a newer boot.
    #[cfg_attr(not(feature = "browser-panel"), allow(dead_code))]
    generation: u64,
    /// Session ids with a prewarm in flight. The first scan of a HOME-rooted
    /// session takes minutes; asking again must not stack a second walk.
    #[cfg_attr(not(feature = "browser-panel"), allow(dead_code))]
    prewarms: HashSet<String>,
    /// Which window owns the child webview; the panel is a singleton.
    attached_window: Option<String>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            state: MindLifecycle::Off,
            restarts: 0,
            last_error: None,
            child: None,
            #[cfg(windows)]
            job: None,
            generation: 0,
            prewarms: HashSet::new(),
            attached_window: None,
        }
    }
}

impl Default for MindState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            port: Arc::new(AtomicU16::new(0)),
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl MindState {
    pub fn snapshot(&self) -> MindStatus {
        let inner = self.inner.lock().expect("MindState mutex poisoned");
        self.status_from(&inner)
    }

    fn status_from(&self, inner: &Inner) -> MindStatus {
        let port = self.port.load(Ordering::SeqCst);
        MindStatus {
            state: inner.state,
            port: (port != 0).then_some(port),
            restarts: inner.restarts,
            last_error: inner.last_error.clone(),
        }
    }
}

/// Kill the sidecar. Called from RunEvent::ExitRequested and RunEvent::Exit
/// (idempotent, and destructors are not guaranteed on process exit); the Job
/// Object handle dropped here is the Windows backstop for whatever the kill
/// missed.
pub fn shutdown(state: &MindState) {
    state.shutdown.store(true, Ordering::SeqCst);
    state.port.store(0, Ordering::SeqCst);
    let mut inner = state.inner.lock().expect("MindState mutex poisoned");
    inner.state = MindLifecycle::Off;
    if let Some(child) = inner.child.take() {
        let _ = child.kill();
    }
    #[cfg(windows)]
    {
        inner.job = None;
    }
}

/// Drop the webview claim when its host window is destroyed by the OS: no
/// frontend runs then, and a claim naming a dead window would lock the panel
/// out of every other window until restart. Mirrors browser::forget_window.
pub fn forget_window(state: &MindState, label: &str) -> bool {
    let mut inner = state.inner.lock().expect("MindState mutex poisoned");
    let matches = inner.attached_window.as_deref() == Some(label);
    if matches {
        inner.attached_window = None;
    }
    matches
}

/// The one line mindwalk prints when the listener is up:
/// `mindwalk serving http://127.0.0.1:PORT`. Anything around it is tolerated;
/// a port of 0 or out of range is not a port.
pub fn parse_serving_line(line: &str) -> Option<u16> {
    const MARKER: &str = "mindwalk serving http://127.0.0.1:";
    let rest = &line[line.find(MARKER)? + MARKER.len()..];
    let digits = rest.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("");
    let port = digits.parse::<u16>().ok()?;
    (port != 0).then_some(port)
}

/// The navigation filter and mind_navigate share this: the panel may only sit
/// on the live sidecar's loopback origin. `port` is the current value from
/// MindState (0 = no server, nothing is allowed).
pub fn is_allowed_mind_url(url: &tauri::Url, port: u16) -> bool {
    port != 0
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port_or_known_default() == Some(port)
}

/// Argument list for `mindwalk serve`; one `--claude-dir` per transcript root.
pub fn serve_args(port: u16, roots: &[std::path::PathBuf]) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = vec![
        "serve".into(),
        "--no-open".into(),
        "--port".into(),
        port.to_string().into(),
    ];
    for root in roots {
        args.push("--claude-dir".into());
        args.push(root.clone().into_os_string());
    }
    args
}

/// Restart budget after an unexpected sidecar death: 1s, 2s, 4s, 8s, 16s,
/// then give up ("dead"). Deliberately never resets within one supervisor's
/// tenure so a crash-looping binary cannot burn CPU forever; a fresh
/// mind_ensure starts a fresh budget.
pub struct Backoff {
    attempts: u32,
}

impl Backoff {
    pub const MAX_ATTEMPTS: u32 = 5;

    pub fn new() -> Self {
        Self { attempts: 0 }
    }

    /// The delay to sleep before the next restart attempt; None when the
    /// budget is spent.
    pub fn next_delay(&mut self) -> Option<Duration> {
        if self.attempts >= Self::MAX_ATTEMPTS {
            return None;
        }
        let delay = Duration::from_secs(1u64 << self.attempts);
        self.attempts += 1;
        Some(delay)
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_allowed_mind_url, parse_serving_line, serve_args, Backoff, MindLifecycle, MindStatus,
    };
    use std::path::PathBuf;

    #[test]
    fn serving_line_yields_the_port() {
        // Exact line observed from the fork binary on this machine.
        assert_eq!(
            parse_serving_line("mindwalk serving http://127.0.0.1:63801"),
            Some(63801)
        );
        assert_eq!(
            parse_serving_line("mindwalk serving http://127.0.0.1:4517\r"),
            Some(4517)
        );
        // Tolerates a prefix and a suffix around the marker.
        assert_eq!(
            parse_serving_line("16:00:00 mindwalk serving http://127.0.0.1:4517 (cold)"),
            Some(4517)
        );
    }

    #[test]
    fn non_serving_lines_yield_nothing() {
        assert_eq!(parse_serving_line(""), None);
        // The bind-failure line observed when the port is taken.
        assert_eq!(
            parse_serving_line("mindwalk: listen tcp 127.0.0.1:4517: bind: already in use"),
            None
        );
        assert_eq!(
            parse_serving_line("mindwalk serving http://localhost:4517"),
            None
        );
        assert_eq!(parse_serving_line("mindwalk serving http://127.0.0.1:"), None);
        assert_eq!(
            parse_serving_line("mindwalk serving http://127.0.0.1:notaport"),
            None
        );
    }

    #[test]
    fn zero_or_out_of_range_ports_are_refused() {
        assert_eq!(parse_serving_line("mindwalk serving http://127.0.0.1:0"), None);
        assert_eq!(
            parse_serving_line("mindwalk serving http://127.0.0.1:65536"),
            None
        );
        assert_eq!(
            parse_serving_line("mindwalk serving http://127.0.0.1:99999999"),
            None
        );
    }

    fn url(s: &str) -> tauri::Url {
        s.parse().expect("test url")
    }

    #[test]
    fn navigation_is_locked_to_the_live_loopback_origin() {
        assert!(is_allowed_mind_url(&url("http://127.0.0.1:4517/"), 4517));
        assert!(is_allowed_mind_url(
            &url("http://127.0.0.1:4517/?session=3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42"),
            4517
        ));
        assert!(is_allowed_mind_url(
            &url("http://127.0.0.1:4517/api/sessions"),
            4517
        ));
        assert!(!is_allowed_mind_url(&url("http://127.0.0.1:4518/"), 4517));
        assert!(!is_allowed_mind_url(&url("https://127.0.0.1:4517/"), 4517));
        assert!(!is_allowed_mind_url(&url("http://localhost:4517/"), 4517));
        assert!(!is_allowed_mind_url(&url("http://127.0.0.2:4517/"), 4517));
        assert!(!is_allowed_mind_url(&url("file:///C:/Windows/win.ini"), 4517));
        // Userinfo trick: the host here is evil.com, not the loopback prefix.
        assert!(!is_allowed_mind_url(
            &url("http://127.0.0.1:4517@evil.com/"),
            4517
        ));
    }

    #[test]
    fn no_live_port_means_no_navigation_at_all() {
        assert!(!is_allowed_mind_url(&url("http://127.0.0.1:4517/"), 0));
    }

    #[test]
    fn the_filter_follows_a_port_change_across_restarts() {
        let target = url("http://127.0.0.1:50000/");
        assert!(!is_allowed_mind_url(&target, 4517));
        assert!(is_allowed_mind_url(&target, 50000));
    }

    #[test]
    fn backoff_walks_the_documented_ladder_then_gives_up() {
        let mut backoff = Backoff::new();
        let secs: Vec<u64> = std::iter::from_fn(|| backoff.next_delay())
            .map(|d| d.as_secs())
            .collect();
        assert_eq!(secs, vec![1, 2, 4, 8, 16]);
        assert_eq!(backoff.next_delay(), None);
        assert_eq!(backoff.next_delay(), None);
    }

    #[test]
    fn serve_args_carry_every_root_in_order() {
        let roots = vec![
            PathBuf::from("/home/u/.claude/projects"),
            PathBuf::from("/home/u/.claude-micah/projects"),
        ];
        let args = serve_args(4517, &roots);
        let expected: Vec<std::ffi::OsString> = [
            "serve",
            "--no-open",
            "--port",
            "4517",
            "--claude-dir",
            "/home/u/.claude/projects",
            "--claude-dir",
            "/home/u/.claude-micah/projects",
        ]
        .into_iter()
        .map(Into::into)
        .collect();
        assert_eq!(args, expected);
    }

    #[test]
    fn status_serializes_camel_case_with_lowercase_state() {
        let status = MindStatus {
            state: MindLifecycle::Dead,
            port: Some(4517),
            restarts: 2,
            last_error: Some("boom".into()),
        };
        assert_eq!(
            serde_json::to_string(&status).expect("serialize"),
            r#"{"state":"dead","port":4517,"restarts":2,"lastError":"boom"}"#
        );
    }
}
