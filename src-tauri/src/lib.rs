mod git;

use serde::Serialize;

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
