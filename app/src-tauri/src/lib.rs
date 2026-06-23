mod sidecar;

use std::sync::Mutex;
use tauri::{Manager, RunEvent};

use sidecar::{SidecarHandle, SIDECAR_PORT};

#[tauri::command]
fn sidecar_port() -> u16 {
    SIDECAR_PORT
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SidecarHandle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![sidecar_port])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            match sidecar::spawn() {
                Ok(child) => {
                    let handle: tauri::State<SidecarHandle> = app.state();
                    *handle.0.lock().unwrap() = Some(child);
                }
                Err(e) => log::error!("failed to spawn sidecar: {e}"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                let handle: tauri::State<SidecarHandle> = app_handle.state();
                sidecar::kill(&handle);
            }
        });
}
