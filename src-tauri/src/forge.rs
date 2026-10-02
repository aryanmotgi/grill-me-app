// ---------------------------------------------------------------------------
// First-run "forge": setup floats over the user's own apps
// (src/components/ForgeOnboarding.tsx). The app window becomes a borderless,
// fully see-through layer over the usable screen, kept above other windows.
// Only what the forge draws catches the mouse: the page reports those areas
// (`forge_hit_rects`) and a small watcher turns click-through on whenever the
// pointer is anywhere else, so clicks on empty space reach the apps behind.
// (macOS can't do per-pixel click-through by itself; this is the standard
// workaround.) The finale calls `forge_window_done` → a normal app window.
// Also saves the shareable workflow card as a PNG, and the frame-rate probes.
// ---------------------------------------------------------------------------

use base64::Engine;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

const APP_W: f64 = 1440.0;
const APP_H: f64 = 900.0;

/// Areas (logical px, relative to the window) the forge draws something in.
static HIT: Mutex<Vec<[f64; 4]>> = Mutex::new(Vec::new());
static OVERLAY: AtomicBool = AtomicBool::new(false);

/// Same rule as the app's `initialFirstRunStep`: a saved step decides;
/// without one, anyone who already used the app (mode, project or the old
/// tour) is not a first run.
pub fn first_run(settings: &Value) -> bool {
    match settings["firstRunStep"].as_str() {
        Some(step) => step != "done",
        None => settings["appMode"].is_null() && settings["activeProject"].is_null() && settings["onboarded"] != true,
    }
}

/// Is the point inside any of the areas?
pub fn hits(rects: &[[f64; 4]], x: f64, y: f64) -> bool {
    rects.iter().any(|r| x >= r[0] && y >= r[1] && x <= r[0] + r[2] && y <= r[1] + r[3])
}

/// First run: a see-through layer over the usable screen (below the menu
/// bar), no title bar or shadow, above other windows, click-through except
/// where the forge draws.
pub fn enter(win: &WebviewWindow) {
    if let Ok(Some(mon)) = win.current_monitor().or_else(|_| win.primary_monitor()) {
        let scale = mon.scale_factor();
        let area = mon.work_area();
        let pos = area.position.to_logical::<f64>(scale);
        let size = area.size.to_logical::<f64>(scale);
        let _ = win.set_decorations(false);
        let _ = win.set_shadow(false);
        let _ = win.set_size(LogicalSize::new(size.width, size.height));
        let _ = win.set_position(LogicalPosition::new(pos.x, pos.y));
    }
    let _ = win.set_always_on_top(true);
    let _ = win.show();
    let _ = win.set_focus();
    OVERLAY.store(true, Ordering::SeqCst);
    let w = win.clone();
    std::thread::spawn(move || {
        let mut through: Option<bool> = None;
        while OVERLAY.load(Ordering::SeqCst) {
            let inside = (|| {
                let cur = w.cursor_position().ok()?;
                let pos = w.inner_position().ok()?;
                let scale = w.scale_factor().ok()?;
                let (x, y) = ((cur.x - pos.x as f64) / scale, (cur.y - pos.y as f64) / scale);
                let rects = HIT.lock().ok()?;
                Some(hits(&rects, x, y))
            })()
            .unwrap_or(true);
            if through != Some(!inside) {
                let _ = w.set_ignore_cursor_events(!inside);
                through = Some(!inside);
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        let _ = w.set_ignore_cursor_events(false);
    });
}

/// The page reports where it draws (buttons, text, the Spark, diagrams).
#[tauri::command]
pub fn forge_hit_rects(rects: Vec<[f64; 4]>) {
    if let Ok(mut h) = HIT.lock() {
        *h = rects.into_iter().take(400).collect();
    }
}

/// Stay above other windows (off while a browser sign-in is open).
#[tauri::command]
pub fn forge_front(app: AppHandle, on: bool) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_always_on_top(on);
        if on { let _ = main.set_focus(); }
    }
}

/// Back to a normal, centred app window that fits the screen.
fn restore(win: &WebviewWindow) {
    let (mut w, mut h) = (APP_W, APP_H);
    if let Ok(Some(mon)) = win.current_monitor() {
        let size = mon.work_area().size.to_logical::<f64>(mon.scale_factor());
        w = w.min(size.width - 40.0);
        h = h.min(size.height - 40.0);
    }
    let _ = win.set_size(LogicalSize::new(w, h));
    let _ = win.center();
}

/// The forge's finale (or Esc): become the normal app window again, with the
/// desktop blur the app uses.
#[tauri::command(async)]
pub fn forge_window_done(app: AppHandle) {
    let Some(main) = app.get_webview_window("main") else { return };
    OVERLAY.store(false, Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(60));
    let _ = main.set_ignore_cursor_events(false);
    let _ = main.set_always_on_top(false);
    let _ = main.set_decorations(true);
    let _ = main.set_shadow(true);
    restore(&main);
    crate::apply_glass(&main);
    let _ = main.set_focus();
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
    fn click_areas() {
        let r = [[10.0, 10.0, 100.0, 40.0], [500.0, 0.0, 20.0, 20.0]];
        assert!(hits(&r, 50.0, 30.0));
        assert!(hits(&r, 510.0, 5.0));
        assert!(!hits(&r, 200.0, 200.0));
        assert!(!hits(&[], 1.0, 1.0));
    }

    #[test]
    fn rejects_non_png() {
        let not_png = base64::engine::general_purpose::STANDARD.encode(b"hello");
        assert!(save_share_card(not_png).is_err());
        assert!(save_share_card("%%%".into()).is_err());
    }
}

/// Frame-rate probes are on only when the app was started with GRILLME_PERF=1.
#[tauri::command]
pub fn perf_enabled() -> bool {
    std::env::var("GRILLME_PERF").map(|v| v == "1").unwrap_or(false)
}

/// Write one probe's report to /tmp/grillme-perf-<name>.json.
#[tauri::command]
pub fn perf_report(name: String, report: String) -> Result<(), String> {
    if !perf_enabled() {
        return Ok(());
    }
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    std::fs::write(format!("/tmp/grillme-perf-{safe}.json"), report).map_err(|e| e.to_string())
}
