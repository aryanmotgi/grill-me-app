// ---------------------------------------------------------------------------
// First-run "forge": setup happens in a full-screen, see-through ember world
// (src/components/ForgeOnboarding.tsx). While it runs, the main window covers
// the whole screen with no title bar; the finale calls `forge_window_done`,
// which turns it back into a normal app window. Also saves the shareable
// workflow card as a PNG.
// ---------------------------------------------------------------------------

use base64::Engine;
use serde_json::Value;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

const APP_W: f64 = 1440.0;
const APP_H: f64 = 900.0;

/// Same rule as the app's `initialFirstRunStep`: a saved step decides;
/// without one, anyone who already used the app (mode, project or the old
/// tour) is not a first run.
pub fn first_run(settings: &Value) -> bool {
    match settings["firstRunStep"].as_str() {
        Some(step) => step != "done",
        None => settings["appMode"].is_null() && settings["activeProject"].is_null() && settings["onboarded"] != true,
    }
}

/// The usable part of the screen the window is on (below the menu bar,
/// above the Dock), in logical points: (x, y, width, height).
pub fn screen_area(win: &WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let mon = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten())?;
    let scale = mon.scale_factor();
    let area = mon.work_area();
    let pos = area.position.to_logical::<f64>(scale);
    let size = area.size.to_logical::<f64>(scale);
    Some((pos.x, pos.y, size.width, size.height))
}

/// Cover the usable screen, without a title bar. Returns the frame used.
pub fn cover_screen(win: &WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let frame = screen_area(win)?;
    let _ = win.set_decorations(false);
    let _ = win.set_size(LogicalSize::new(frame.2, frame.3));
    let _ = win.set_position(LogicalPosition::new(frame.0, frame.1));
    Some(frame)
}

/// Back to a normal, centred app window that fits the screen.
fn restore(win: &WebviewWindow) {
    let (mut w, mut h) = (APP_W, APP_H);
    if let Ok(Some(mon)) = win.current_monitor() {
        let size = mon.size().to_logical::<f64>(mon.scale_factor());
        w = w.min(size.width - 40.0);
        h = h.min(size.height - 80.0);
    }
    let _ = win.set_decorations(true);
    let _ = win.set_size(LogicalSize::new(w, h));
    let _ = win.center();
}

/// The forge's finale (or "Skip to app"): normal window again.
#[tauri::command]
pub fn forge_window_done(app: AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        restore(&main);
        let _ = main.set_focus();
    }
}

/// Save the workflow card to ~/Downloads (never overwriting) and show it in
/// Finder. Takes the PNG as base64 (from a canvas). Returns the path.
#[tauri::command]
pub fn save_share_card(png_base64: String) -> Result<String, String> {
    let raw = png_base64.trim_start_matches("data:image/png;base64,");
    let bytes = base64::engine::general_purpose::STANDARD.decode(raw).map_err(|_| "That image couldn't be read".to_string())?;
    if bytes.len() > 8_000_000 || !bytes.starts_with(b"\x89PNG") {
        return Err("That isn't a PNG".into());
    }
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let dir = std::path::Path::new(&home).join("Downloads");
    let path = free_name(&dir, "grill-me-workflow", "png");
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let _ = std::process::Command::new("open").arg("-R").arg(&path).spawn();
    Ok(path.to_string_lossy().into_owned())
}

fn free_name(dir: &std::path::Path, stem: &str, ext: &str) -> std::path::PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..1000).map(|n| dir.join(format!("{stem}-{n}.{ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn who_gets_the_forge() {
        assert!(first_run(&json!({})));
        assert!(first_run(&json!({ "firstRunStep": "scan" })));
        assert!(!first_run(&json!({ "firstRunStep": "done" })));
        assert!(!first_run(&json!({ "appMode": "solo" })));
        assert!(!first_run(&json!({ "activeProject": "p" })));
        assert!(!first_run(&json!({ "onboarded": true })));
    }

    #[test]
    fn never_overwrites_a_saved_card() {
        let dir = std::env::temp_dir().join(format!("grillme-card-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_name(&dir, "c", "png"), dir.join("c.png"));
        std::fs::write(dir.join("c.png"), b"x").unwrap();
        assert_eq!(free_name(&dir, "c", "png"), dir.join("c-2.png"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_non_png() {
        let not_png = base64::engine::general_purpose::STANDARD.encode(b"hello");
        assert!(save_share_card(not_png).is_err());
        assert!(save_share_card("%%%".into()).is_err());
    }
}
