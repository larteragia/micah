//! Everything that touches the live sidecar or its webview.
//!
//! Behind the `browser-panel` feature for the same reason as browser/panel.rs:
//! the child webview needs Tauri's `unstable` API, and the sidecar without
//! its webview has no consumer, so both halves share the gate.

use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use shared_child::SharedChild;
use tauri::{LogicalPosition, LogicalSize, Manager, State, WebviewUrl};

use crate::modules::pty::agent_detect::is_uuid;

use super::{
    is_allowed_mind_url, parse_serving_line, serve_args, Backoff, MindLifecycle, MindState,
    MindStatus, WEBVIEW_LABEL,
};

/// Tried first so mindwalk's UI keeps one stable localStorage origin across
/// runs; when taken the process exits at bind and the retry uses `--port 0`.
const PREFERRED_PORT: u16 = 4517;
/// How long the sidecar gets to print its serving line before the boot is
/// declared dead. Startup is instant when healthy (measured well under 1s).
const BOOT_TIMEOUT: Duration = Duration::from_secs(10);
/// The first scan of a HOME-rooted session walks the whole tree (~4 min
/// measured on this machine); the prewarm request must outlive it.
const PREWARM_TIMEOUT: Duration = Duration::from_secs(600);
const WAIT_RETRY_INTERVAL: Duration = Duration::from_millis(500);
/// Sanity cap on mind_wait_session, so a frontend typo cannot park an IPC
/// call for hours.
const WAIT_TIMEOUT_CAP_MS: u64 = 600_000;

// ---------------------------------------------------------------------------
// Sidecar: resolution, boot, supervision.
// ---------------------------------------------------------------------------

/// Same resolution as control.rs find_bundled_cli: Tauri places sidecars next
/// to the app executable in dev and prod; a debug build running outside that
/// layout (tests, plain cargo run) falls back to the raw triple-suffixed file
/// under src-tauri/binaries.
fn find_bundled_mindwalk() -> Option<PathBuf> {
    let filename = if cfg!(windows) {
        "mindwalk.exe"
    } else {
        "mindwalk"
    };
    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.join(filename)))
        .filter(|path| is_sidecar_candidate(path))
    {
        return Some(path);
    }

    if cfg!(debug_assertions) {
        let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let target = option_env!("TAURI_ENV_TARGET_TRIPLE")?;
        let candidate = binaries.join(format!(
            "mindwalk-{target}{}",
            std::env::consts::EXE_SUFFIX
        ));
        return is_sidecar_candidate(&candidate).then_some(candidate);
    }
    None
}

fn is_sidecar_candidate(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
}

/// The exact roots claude_session tails, derived the same way from the same
/// HOME, so the mind never watches a different set of transcripts than the
/// rest of the app. Missing dirs are passed as-is: the fork keeps a
/// nonexistent dir in absolute form and serves it as empty.
fn claude_roots() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "could not resolve the home directory".to_string())?;
    Ok(crate::modules::fs::claude_session::transcript_roots(&home))
}

struct Booted {
    child: Arc<SharedChild>,
    port: u16,
    #[cfg(windows)]
    job: Option<crate::modules::proc::job::ProcessJob>,
}

enum BootAttempt {
    Serving(Booted),
    /// The process died before announcing a port; the string carries its
    /// stderr tail (a taken port exits here in under a second).
    ExitedEarly(String),
}

fn spawn_once(binary: &Path, roots: &[PathBuf], port: u16) -> Result<BootAttempt, String> {
    let mut cmd = std::process::Command::new(binary);
    cmd.args(serve_args(port, roots))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // The binary is a console app; without this every boot flashes a window.
    crate::modules::proc::hide_console(&mut cmd);
    // Windows gets the job object below; on Linux the kernel delivers SIGKILL
    // to the sidecar when micah dies dirty. macOS has no equivalent — a
    // SIGKILLed micah can orphan the server there (documented in the card).
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
    }

    let child = Arc::new(
        SharedChild::spawn(&mut cmd).map_err(|e| format!("spawn {}: {e}", binary.display()))?,
    );

    // Registered immediately after the spawn: if micah dies dirty from here
    // on, closing this handle makes the OS kill the server.
    #[cfg(windows)]
    let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
        Ok(job) => Some(job),
        Err(e) => {
            log::warn!("mind: could not assign mindwalk to a job object: {e}");
            None
        }
    };

    let stdout = child.take_stdout().ok_or_else(|| {
        let _ = child.kill();
        "mindwalk spawned without a stdout pipe".to_string()
    })?;

    // Both pipes are drained to EOF for the process lifetime so a chatty
    // server can never block on a full pipe; stderr additionally keeps a
    // bounded tail for the early-exit diagnostic.
    let stderr_tail: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    if let Some(pipe) = child.take_stderr() {
        let tail = stderr_tail.clone();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(pipe).lines() {
                // A non-UTF8 line must not end the drain: an abandoned pipe
                // eventually fills and blocks the server.
                let Ok(line) = line else { continue };
                let mut tail = tail.lock().expect("mindwalk stderr tail mutex poisoned");
                if tail.len() < 4096 {
                    if !tail.is_empty() {
                        tail.push('\n');
                    }
                    tail.push_str(&line);
                }
            }
        });
    }

    let (tx, rx) = mpsc::channel::<u16>();
    std::thread::spawn(move || {
        let mut tx = Some(tx);
        for line in std::io::BufReader::new(stdout).lines() {
            let Ok(line) = line else { continue };
            if let Some(sender) = tx.as_ref() {
                if let Some(port) = parse_serving_line(&line) {
                    let _ = sender.send(port);
                    tx = None;
                }
            }
        }
    });

    let deadline = Instant::now() + BOOT_TIMEOUT;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(port) => {
                return Ok(BootAttempt::Serving(Booted {
                    child,
                    port,
                    #[cfg(windows)]
                    job,
                }))
            }
            Err(reason) => {
                // Disconnected means stdout hit EOF without a serving line:
                // the process is dying. recv would then return instantly, so
                // pace the loop by hand while try_wait catches up.
                if reason == RecvTimeoutError::Disconnected {
                    std::thread::sleep(Duration::from_millis(50));
                }
                if let Ok(Some(status)) = child.try_wait() {
                    let tail = stderr_tail
                        .lock()
                        .expect("mindwalk stderr tail mutex poisoned")
                        .clone();
                    let detail = if tail.is_empty() {
                        String::new()
                    } else {
                        format!(": {tail}")
                    };
                    return Ok(BootAttempt::ExitedEarly(format!(
                        "mindwalk exited during boot ({status}){detail}"
                    )));
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return Err(format!(
                        "mindwalk did not report its port within {}s",
                        BOOT_TIMEOUT.as_secs()
                    ));
                }
            }
        }
    }
}

/// One full boot: preferred port first (stable localStorage origin for the
/// UI), then an OS-assigned port when something else holds it.
fn boot() -> Result<Booted, String> {
    let binary = find_bundled_mindwalk().ok_or_else(|| {
        "the bundled mindwalk binary is missing (run pnpm build:mindwalk)".to_string()
    })?;
    let roots = claude_roots()?;
    match spawn_once(&binary, &roots, PREFERRED_PORT)? {
        BootAttempt::Serving(booted) => Ok(booted),
        BootAttempt::ExitedEarly(first) => match spawn_once(&binary, &roots, 0)? {
            BootAttempt::Serving(booted) => Ok(booted),
            BootAttempt::ExitedEarly(second) => {
                Err(format!("{first}; retried on an OS-assigned port: {second}"))
            }
        },
    }
}

/// Publish a successful boot into the shared state. Returns the child for the
/// supervisor, or None when the boot lost a race (shutdown or a newer
/// generation) and was killed instead.
fn install_success(
    app: &tauri::AppHandle,
    generation: u64,
    booted: Booted,
) -> Option<Arc<SharedChild>> {
    let state = app.state::<MindState>();
    let stale = {
        let mut inner = state.inner.lock().expect("MindState mutex poisoned");
        if state.shutdown.load(Ordering::SeqCst) || inner.generation != generation {
            // Never leave our own claim parked in Starting: a boot raced by
            // shutdown resets to Off so a later mind_ensure can claim again.
            if inner.generation == generation && inner.state == MindLifecycle::Starting {
                inner.state = MindLifecycle::Off;
            }
            true
        } else {
            inner.child = Some(booted.child.clone());
            #[cfg(windows)]
            {
                inner.job = booted.job;
            }
            inner.state = MindLifecycle::Ready;
            inner.last_error = None;
            state.port.store(booted.port, Ordering::SeqCst);
            false
        }
    };
    if stale {
        let _ = booted.child.kill();
        return None;
    }
    Some(booted.child)
}

fn spawn_supervisor(app: tauri::AppHandle, generation: u64, child: Arc<SharedChild>) {
    let spawned = std::thread::Builder::new()
        .name("mindwalk-supervisor".into())
        .spawn(move || supervise(app, generation, child));
    if let Err(e) = spawned {
        log::warn!("mind: could not spawn the mindwalk supervisor: {e}");
    }
}

/// Watch the child; on unexpected death restart it with the Backoff budget,
/// republish the (new) port and point an attached webview at the new root.
/// Intentional kills (shutdown flag) and superseded generations exit quietly.
fn supervise(app: tauri::AppHandle, generation: u64, mut child: Arc<SharedChild>) {
    let state = app.state::<MindState>();
    let mut backoff = Backoff::new();
    loop {
        let exit = child.wait();
        if state.shutdown.load(Ordering::SeqCst) {
            return;
        }
        {
            let mut inner = state.inner.lock().expect("MindState mutex poisoned");
            if inner.generation != generation {
                return;
            }
            inner.state = MindLifecycle::Starting;
            inner.child = None;
            #[cfg(windows)]
            {
                inner.job = None;
            }
            inner.last_error = Some(match &exit {
                Ok(status) => format!("mindwalk exited unexpectedly ({status})"),
                Err(e) => format!("mindwalk exited unexpectedly (wait failed: {e})"),
            });
        }
        state.port.store(0, Ordering::SeqCst);
        emit_status(&app, &state);
        log::warn!("mind: mindwalk died; attempting restart");

        let booted = loop {
            let Some(delay) = backoff.next_delay() else {
                // Scoped: emit_status re-locks this mutex through snapshot(),
                // so the guard must be dead before the emit or the supervisor
                // deadlocks holding MindState forever (delta audit finding).
                {
                    let mut inner = state.inner.lock().expect("MindState mutex poisoned");
                    if inner.generation == generation {
                        inner.state = MindLifecycle::Dead;
                        let prior = inner.last_error.take().unwrap_or_default();
                        inner.last_error = Some(format!(
                            "{prior}; gave up after {} restart attempts",
                            Backoff::MAX_ATTEMPTS
                        ));
                    }
                }
                log::warn!("mind: restart budget spent, mindwalk stays dead");
                emit_status(&app, &state);
                return;
            };
            if !sleep_unless_shutdown(&state.shutdown, delay) {
                return;
            }
            match boot() {
                Ok(booted) => break booted,
                Err(e) => {
                    let mut inner = state.inner.lock().expect("MindState mutex poisoned");
                    if inner.generation != generation || state.shutdown.load(Ordering::SeqCst) {
                        return;
                    }
                    inner.last_error = Some(e);
                }
            }
        };

        let port = booted.port;
        let Some(new_child) = install_success(&app, generation, booted) else {
            return;
        };
        state
            .inner
            .lock()
            .expect("MindState mutex poisoned")
            .restarts += 1;
        log::info!("mind: mindwalk restarted on 127.0.0.1:{port}");
        // The attached webview still points at the dead port. Preserve the
        // path and query (the ?session deep-link above all) and swap only the
        // port — navigating to the bare root would silently fall back to the
        // "latest" session, the exact symptom this card exists to kill.
        if let Some(webview) = app.get_webview(WEBVIEW_LABEL) {
            let carried = webview.url().ok().and_then(|mut current| {
                current.set_port(Some(port)).ok()?;
                Some(current)
            });
            let target =
                carried.or_else(|| format!("http://127.0.0.1:{port}/").parse().ok());
            if let Some(url) = target {
                let _ = webview.navigate(url);
            }
        }
        // The frontend re-runs its handshake off this: status.port went stale
        // the moment the old server died, and nothing else tells it.
        emit_status(&app, &state);
        child = new_child;
    }
}

/// Every supervisor-driven transition is pushed to the frontend: the panel
/// otherwise has no reason to re-read mind_status after boot, and a sidecar
/// dying (or coming back on a new port) would leave a dead page with no
/// Religar screen.
fn emit_status(app: &tauri::AppHandle, state: &State<'_, MindState>) {
    use tauri::Emitter;
    let _ = app.emit("micah:mind-status", state.snapshot());
}

/// Returns false when the shutdown flag was raised mid-sleep.
fn sleep_unless_shutdown(shutdown: &Arc<AtomicBool>, total: Duration) -> bool {
    let deadline = Instant::now() + total;
    loop {
        if shutdown.load(Ordering::SeqCst) {
            return false;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return true;
        }
        std::thread::sleep(remaining.min(Duration::from_millis(100)));
    }
}

// ---------------------------------------------------------------------------
// Sidecar commands.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn mind_status(state: State<'_, MindState>) -> Result<MindStatus, String> {
    Ok(state.snapshot())
}

enum Claim {
    Ready(MindStatus),
    Wait,
    Boot(u64),
}

/// Bring the sidecar up if it is not already. Idempotent and race-safe: the
/// Starting slot is claimed before the slow work, so concurrent callers wait
/// for the one boot instead of spawning a second server.
#[tauri::command]
pub async fn mind_ensure(
    app: tauri::AppHandle,
    _window: tauri::Window,
    state: State<'_, MindState>,
) -> Result<MindStatus, String> {
    let claim = {
        let mut inner = state.inner.lock().expect("MindState mutex poisoned");
        match inner.state {
            MindLifecycle::Ready => Claim::Ready(state.status_from(&inner)),
            MindLifecycle::Starting => Claim::Wait,
            MindLifecycle::Off | MindLifecycle::Dead => {
                // An explicit ensure is the retry path: clear a shutdown
                // latch left by a prevented exit, or the sidecar could
                // never come back for the lifetime of the process.
                state.shutdown.store(false, Ordering::SeqCst);
                inner.state = MindLifecycle::Starting;
                inner.last_error = None;
                inner.generation += 1;
                Claim::Boot(inner.generation)
            }
        }
    };
    match claim {
        Claim::Ready(status) => Ok(status),
        Claim::Wait => {
            // A boot (or a supervised restart) is already in flight; report
            // its outcome, or a truthful "starting" if it outlasts us.
            let deadline = Instant::now() + BOOT_TIMEOUT + Duration::from_secs(2);
            loop {
                {
                    let inner = state.inner.lock().expect("MindState mutex poisoned");
                    if inner.state != MindLifecycle::Starting {
                        return Ok(state.status_from(&inner));
                    }
                }
                if Instant::now() >= deadline {
                    return Ok(state.snapshot());
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        Claim::Boot(generation) => {
            // boot() blocks for up to two spawn budgets; never on the runtime.
            let result = tauri::async_runtime::spawn_blocking(boot)
                .await
                .unwrap_or_else(|e| Err(format!("mindwalk boot task failed: {e}")));
            match result {
                Ok(booted) => {
                    let port = booted.port;
                    if let Some(child) = install_success(&app, generation, booted) {
                        spawn_supervisor(app.clone(), generation, child);
                        log::info!("mind: mindwalk serving on 127.0.0.1:{port}");
                    }
                }
                Err(error) => {
                    log::warn!("mind: mindwalk failed to boot: {error}");
                    let mut inner = state.inner.lock().expect("MindState mutex poisoned");
                    if inner.generation == generation && !state.shutdown.load(Ordering::SeqCst) {
                        inner.state = MindLifecycle::Dead;
                        inner.last_error = Some(error);
                        inner.child = None;
                    }
                }
            }
            Ok(state.snapshot())
        }
    }
}

/// Fire-and-forget GET of the session's trace so the expensive first scan
/// happens before the user opens the panel. Deduped per session id.
#[tauri::command]
pub async fn mind_prewarm(
    app: tauri::AppHandle,
    state: State<'_, MindState>,
    session_id: String,
) -> Result<(), String> {
    if !is_uuid(&session_id) {
        return Err("invalid session id".into());
    }
    let id = session_id.to_lowercase();
    let port = state.port.load(Ordering::SeqCst);
    if port == 0 {
        return Err("mindwalk is not running; call mind_ensure first".into());
    }
    {
        let mut inner = state.inner.lock().expect("MindState mutex poisoned");
        if !inner.prewarms.insert(id.clone()) {
            return Ok(());
        }
    }
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        match prewarm_request(port, &id).await {
            Ok(status) => {
                log::info!("mind: prewarm {id}: {status} after {:.1?}", started.elapsed())
            }
            Err(e) => {
                log::warn!("mind: prewarm {id} failed after {:.1?}: {e}", started.elapsed())
            }
        }
        let state = app.state::<MindState>();
        state
            .inner
            .lock()
            .expect("MindState mutex poisoned")
            .prewarms
            .remove(&id);
    });
    Ok(())
}

/// Only the status matters: a 200 means the server finished the walk and
/// cached the trace. The body is dropped unread.
async fn prewarm_request(port: u16, id: &str) -> Result<reqwest::StatusCode, String> {
    let client = reqwest::Client::builder()
        .timeout(PREWARM_TIMEOUT)
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let url = format!("http://127.0.0.1:{port}/api/sessions/{id}/trace");
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    Ok(response.status())
}

/// Handshake before navigating the webview to a session: a newborn session
/// may not be in the server's scan yet (5s TTL) and the UI would silently
/// fall back to "latest". Everything short of a 200 — 404, a refused
/// connection while the sidecar restarts, a transient 500 mid-append — sleeps
/// and retries until the budget runs out; false only means the budget was
/// truly spent. A dead sidecar (port 0) is an error so the caller re-reads
/// mind_status instead of looping.
#[tauri::command]
pub async fn mind_wait_session(
    state: State<'_, MindState>,
    session_id: String,
    timeout_ms: u64,
) -> Result<bool, String> {
    if !is_uuid(&session_id) {
        return Err("invalid session id".into());
    }
    let id = session_id.to_lowercase();
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.min(WAIT_TIMEOUT_CAP_MS));
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    loop {
        // Re-read every attempt: a supervised restart moves the port.
        let port = state.port.load(Ordering::SeqCst);
        if port == 0 {
            return Err("mindwalk is not running; call mind_ensure first".into());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(false);
        }
        let url = format!("http://127.0.0.1:{port}/api/sessions/{id}/trace");
        match client.get(&url).timeout(remaining).send().await {
            Ok(response) if response.status() == reqwest::StatusCode::OK => return Ok(true),
            // Anything else is worth another try inside the budget; returning
            // early would turn the frontend's while-loop into a hot loop.
            Ok(_) | Err(_) => {}
        }
        let pause = WAIT_RETRY_INTERVAL.min(deadline.saturating_duration_since(Instant::now()));
        if pause.is_zero() {
            return Ok(false);
        }
        tokio::time::sleep(pause).await;
    }
}

// ---------------------------------------------------------------------------
// Webview commands (mirrors of the browser panel).
// ---------------------------------------------------------------------------

/// Create the mind webview as a child of the calling window, pointed at the
/// sidecar's root.
///
/// `async` is not decoration: `Window::add_child` posts to the main thread
/// and blocks on the reply, so a synchronous command would deadlock. The
/// window comes from the IPC caller, never from a parameter, and the slot is
/// claimed before the slow work (see browser_attach).
#[tauri::command]
pub async fn mind_attach(
    caller: tauri::Window,
    state: State<'_, MindState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window_label = caller.label().to_string();
    let port = state.port.load(Ordering::SeqCst);
    if port == 0 {
        return Err("mindwalk is not running; call mind_ensure first".to_string());
    }
    {
        let mut inner = state.inner.lock().expect("MindState mutex poisoned");
        match inner.attached_window.as_deref() {
            Some(label) if label == window_label => return Ok(()),
            Some(label) => {
                return Err(format!(
                    "the mind panel is already attached to window \"{label}\"; only one exists per process"
                ));
            }
            None => inner.attached_window = Some(window_label.clone()),
        }
    }

    let url = format!("http://127.0.0.1:{port}/")
        .parse::<tauri::Url>()
        .map_err(|e| format!("mind url: {e}"))?;
    let live_port = state.port.clone();
    // No data_directory and no additional_browser_args on purpose: the
    // default environment never conflicts with the app's own webview, and
    // localStorage survives under the stable preferred-port origin.
    let builder = tauri::webview::WebviewBuilder::new(WEBVIEW_LABEL, WebviewUrl::External(url))
        .on_navigation(move |url| is_allowed_mind_url(url, live_port.load(Ordering::SeqCst)));

    let attached = caller.add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width.max(1.0), height.max(1.0)),
    );
    if let Err(e) = attached {
        // Release the claim, or a transient failure would lock the panel out
        // of every window until the app restarts.
        let mut inner = state.inner.lock().expect("MindState mutex poisoned");
        if inner.attached_window.as_deref() == Some(window_label.as_str()) {
            inner.attached_window = None;
        }
        return Err(format!("could not create the mind webview: {e}"));
    }
    Ok(())
}

/// Only URLs inside the live sidecar's loopback origin are accepted; this is
/// the same rule the navigation filter enforces, applied before asking the
/// webview to move.
#[tauri::command]
pub async fn mind_navigate(
    app: tauri::AppHandle,
    state: State<'_, MindState>,
    url: String,
) -> Result<(), String> {
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("bad url {url}: {e}"))?;
    let port = state.port.load(Ordering::SeqCst);
    if !is_allowed_mind_url(&parsed, port) {
        return Err(if port == 0 {
            "refused: mindwalk is not running".to_string()
        } else {
            format!("refused: the mind panel only navigates within http://127.0.0.1:{port}/")
        });
    }
    let webview = app
        .get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the mind panel is not attached".to_string())?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mind_set_bounds(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the mind panel is not attached".to_string())?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
        .map_err(|e| e.to_string())
}

/// Hidden, not resized to nothing: a zero-size webview keeps painting a
/// sliver on Windows, and "suppressed" must stay distinguishable from "gone".
#[tauri::command]
pub async fn mind_set_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let webview = app
        .get_webview(WEBVIEW_LABEL)
        .ok_or_else(|| "the mind panel is not attached".to_string())?;
    if visible {
        webview.show().map_err(|e| e.to_string())
    } else {
        webview.hide().map_err(|e| e.to_string())
    }
}

/// Close the webview and release the claim. The sidecar stays up on purpose:
/// its caches are the expensive part, and re-attaching is then instant.
#[tauri::command]
pub async fn mind_detach(
    app: tauri::AppHandle,
    state: State<'_, MindState>,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(WEBVIEW_LABEL) {
        let _ = webview.close();
    }
    state
        .inner
        .lock()
        .expect("MindState mutex poisoned")
        .attached_window = None;
    Ok(())
}
