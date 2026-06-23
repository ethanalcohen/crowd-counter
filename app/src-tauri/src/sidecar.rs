use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub struct SidecarHandle(pub Mutex<Option<Child>>);

pub const SIDECAR_PORT: u16 = 17893;

fn repo_root() -> PathBuf {
    // src-tauri/ -> app/ -> repo root
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or(manifest_dir)
}

pub fn spawn() -> std::io::Result<Child> {
    let root = repo_root();
    log::info!("spawning sidecar from repo root: {}", root.display());

    Command::new("uv")
        .arg("run")
        .arg("python")
        .arg("-m")
        .arg("app.sidecar.server")
        .arg("--port")
        .arg(SIDECAR_PORT.to_string())
        .current_dir(&root)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
}

pub fn kill(handle: &SidecarHandle) {
    if let Ok(mut guard) = handle.0.lock() {
        if let Some(mut child) = guard.take() {
            log::info!("killing sidecar pid={}", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
