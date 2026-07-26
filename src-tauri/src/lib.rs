mod debug_server;
mod git;

use serde::Serialize;
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
    tauri: String,
    os: String,
    arch: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            git::repo_list,
            git::repo_add,
            git::repo_remove,
            git::repo_info,
            git::repo_log,
            git::repo_branches,
            git::repo_status,
            git::repo_diff,
            git::repo_stage,
            git::repo_commit,
        ])
        .setup(|app| {
            // Built manually (instead of via tauri.conf.json's `app.windows`) so we
            // can attach the debug-server's console-capture init script before the
            // page ever loads. See src/debug_server.rs + skills/app-tools.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("GAIA Space")
                .inner_size(800.0, 600.0)
                .min_inner_size(480.0, 360.0)
                .resizable(true)
                .initialization_script(&debug_server::init_script())
                .build()?;
            debug_server::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
