//! The panel, compiled out.
//!
//! Built when the `browser-panel` feature is off. The commands stay registered
//! and answer with a reason, so the frontend's error path is exercised by the
//! rollback build instead of the IPC layer failing with "command not found" —
//! and `cargo check --no-default-features` proves the crate still compiles
//! against Tauri's stable API surface.

use tauri::State;

use super::{BrowserInfo, BrowserState, CdpInfo};

const DISABLED: &str = "this build was compiled without the browser panel";

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn browser_attach(
    _app: tauri::AppHandle,
    _caller: tauri::Window,
    _state: State<'_, BrowserState>,
    _url: String,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<BrowserInfo, String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_detach(
    _app: tauri::AppHandle,
    _state: State<'_, BrowserState>,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
    _app: tauri::AppHandle,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_set_visible(
    _app: tauri::AppHandle,
    _visible: bool,
) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_navigate(
    _app: tauri::AppHandle,
    _url: String,
) -> Result<Option<String>, String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_go(_app: tauri::AppHandle, _delta: i32) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_reload(_app: tauri::AppHandle) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_url(_app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub async fn browser_cdp(_state: State<'_, BrowserState>) -> Result<Option<CdpInfo>, String> {
    Ok(None)
}

#[tauri::command]
pub async fn browser_page_info(_app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_extensions_list(
    _app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_extension_add(
    _app: tauri::AppHandle,
    _path: String,
) -> Result<serde_json::Value, String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_extension_remove(_app: tauri::AppHandle, _id: String) -> Result<(), String> {
    Err(DISABLED.to_string())
}

#[tauri::command]
pub async fn browser_clear_data(
    _app: tauri::AppHandle,
    _kinds: Vec<String>,
) -> Result<(), String> {
    Err(DISABLED.to_string())
}
