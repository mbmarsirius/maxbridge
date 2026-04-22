#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    proxy_endpoint: &'static str,
    status_source: &'static str,
    notes: &'static str,
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Maxbridge",
        version: "0.1.0",
        proxy_endpoint: "http://127.0.0.1:7423",
        status_source: "http://127.0.0.1:7423/v1/status",
        notes: "Live vs stub, key presence, and default model are served by the Maxbridge proxy at status_source. The Tauri shell never asserts those values itself.",
    }
}

/// Open Terminal.app and run a whitelisted command in it.
///
/// Security: the input is matched against an explicit whitelist before being
/// passed to `osascript`. Only the two exact strings below are ever accepted;
/// anything else (including otherwise-innocent extensions, shell metacharacters,
/// or quoting tricks) is rejected. This is v0 — any additional command requires
/// a security-reviewed PR that extends the whitelist.
#[tauri::command]
fn open_terminal_run(command: String) -> Result<(), String> {
    let allowed = ["claude setup-token", "brew install anthropic/claude/claude"];
    if !allowed.contains(&command.as_str()) {
        return Err(format!("command not whitelisted: {}", command));
    }
    // Extra belt-and-suspenders: reject shell metacharacters. The whitelist
    // already ensures this can't fire, but keep the explicit check so future
    // whitelist edits can't quietly introduce injection bugs.
    for bad in &[';', '&', '|', '`', '"', '\\'] {
        if command.contains(*bad) {
            return Err(format!("command contains disallowed character: {}", bad));
        }
    }
    if command.contains("$(") {
        return Err("command contains disallowed substring: $(".to_string());
    }

    let script = format!(r#"tell application "Terminal" to do script "{}""#, command);
    Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|e| e.to_string())?;
    // Bring Terminal to the front so the user sees what just opened.
    let activate = r#"tell application "Terminal" to activate"#;
    let _ = Command::new("osascript").args(["-e", activate]).status();
    Ok(())
}

/// Restart the OpenClaw gateway LaunchAgent so it re-reads its config.
#[tauri::command]
fn restart_openclaw_gateway() -> Result<(), String> {
    let uid = unsafe { libc::getuid() }.to_string();
    let target = format!("gui/{}/ai.openclaw.gateway", uid);
    let status = Command::new("launchctl")
        .args(["kickstart", "-k", &target])
        .status()
        .map_err(|e| format!("launchctl spawn failed: {}", e))?;
    if !status.success() {
        return Err(format!("launchctl exit {}", status.code().unwrap_or(-1)));
    }
    Ok(())
}

/// Does `brew` exist on $PATH?
#[tauri::command]
fn detect_homebrew() -> bool {
    Command::new("which")
        .arg("brew")
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false)
}

/// Holds the spawned Node child so it dies with the app.
struct ProxyChild(Mutex<Option<Child>>);

impl Drop for ProxyChild {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to resolve resource_dir");

            let node_bin = resource_dir.join("node-runtime/bin/node");
            let server_js = resource_dir.join("server-bundle/server.js");

            eprintln!(
                "[maxbridge-shell] spawning {} {}",
                node_bin.display(),
                server_js.display()
            );

            let child = Command::new(&node_bin)
                .arg(&server_js)
                .env("MAXBRIDGE_PORT", "7423")
                .env("MAXBRIDGE_LICENSE_BYPASS", "1")
                .env("NODE_ENV", "production")
                .spawn()
                .expect("Failed to start Maxbridge proxy (bundled node)");

            app.manage(ProxyChild(Mutex::new(Some(child))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            open_terminal_run,
            restart_openclaw_gateway,
            detect_homebrew
        ])
        .run(tauri::generate_context!())
        .expect("error while running Maxbridge");
}
