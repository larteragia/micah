//! The mind panel, compiled out.
//!
//! Built when the `browser-panel` feature is off. The commands stay
//! registered and answer with a reason, so the frontend's error path is
//! exercised by the rollback build instead of the IPC layer failing with
//! "command not found" - and `cargo check --no-default-features` proves the
//! crate still compiles against Tauri's stable API surface.

use tauri::State;

use super::{MindState, MindStatus};

const DISABLED: &str = "this build was compiled without the mind panel";

#[tauri::command]
pub async fn mind_status(state: State<'_, MindState>) -> Result<MindStatus, String> {
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn mind_ensure(
    _window: tauri::Window,
    _state: State<'_, MindState>,
) -> Result<MindStatus, String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn mind_prewarm(
    _state: State<'_, MindState>,
    _session_id: String,
) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn mind_wait_session(
    _state: State<'_, MindState>,
    _session_id: String,
    _timeout_ms: u64,
) -> Result<bool, String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn mind_attach(
    _caller: tauri::Window,
    _state: State<'_, MindState>,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn mind_navigate(
    _app: tauri::AppHandle,
    _state: State<'_, MindState>,
    _url: String,
) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn mind_set_bounds(
    _app: tauri::AppHandle,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn mind_set_visible(_app: tauri::AppHandle, _visible: bool) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn mind_detach(
    _app: tauri::AppHandle,
    _state: State<'_, MindState>,
) -> Result<(), String> {
    Ok(())
}
