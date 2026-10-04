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
    // "Finish later" last time: setup resumes at launch
    if settings["firstRunPaused"].is_string() {
        return true;
    }
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
    // soft vibrancy only behind what the forge draws (masked by the page)
    crate::blur::install(win);
    let _ = win.show();
    let _ = win.set_focus();
    OVERLAY.store(true, Ordering::SeqCst);
    escape_anywhere(win.app_handle(), true);
    let w = win.clone();
    std::thread::spawn(move || {
        let mut through: Option<bool> = None;
        while OVERLAY.load(Ordering::SeqCst) {
            let inside = (|| {
                let (x, y) = cursor_in_window(&w)?;
                let rects = HIT.lock().ok()?;
                Some(hits(&rects, x, y))
            })()
            .unwrap_or(true);
            hit_log(&w, inside);
            if through != Some(!inside) {
                let _ = w.set_ignore_cursor_events(!inside);
                through = Some(!inside);
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        let _ = w.set_ignore_cursor_events(false);
    });
}

/// The cursor in the window's own CSS pixels (= macOS points from its
/// top-left). Both the cursor and the window are read in global points: the
/// generic cursor position is scaled by the *main* display, so on a Retina
/// laptop plus a 1x external screen it lands ~2x off and every click falls
/// through.
fn cursor_in_window(w: &WebviewWindow) -> Option<(f64, f64)> {
    let scale = w.scale_factor().ok()?;
    let pos = w.inner_position().ok()?.to_logical::<f64>(scale);
    let (cx, cy) = cursor_points().or_else(|| {
        let c = w.cursor_position().ok()?;
        Some((c.x / scale, c.y / scale))
    })?;
    Some((cx - pos.x, cy - pos.y))
}

/// The cursor in global points, origin top-left of the main display.
#[cfg(target_os = "macos")]
pub(crate) fn cursor_points() -> Option<(f64, f64)> {
    #[repr(C)]
    struct CGPoint { x: f64, y: f64 }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CGEventGetLocation(event: *mut std::ffi::c_void) -> CGPoint;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const std::ffi::c_void);
    }
    // a null-source event just carries the current cursor location
    unsafe {
        let ev = CGEventCreate(std::ptr::null());
        if ev.is_null() { return None; }
        let p = CGEventGetLocation(ev);
        CFRelease(ev);
        Some((p.x, p.y))
    }
}
#[cfg(not(target_os = "macos"))]
fn cursor_points() -> Option<(f64, f64)> { None }

/// GRILLME_HITLOG=1: once a second, where the cursor is and what the page
/// says is clickable (to debug clicks falling through).
fn hit_log(w: &WebviewWindow, inside: bool) {
    use std::sync::atomic::AtomicU64;
    static LAST: AtomicU64 = AtomicU64::new(0);
    if std::env::var("GRILLME_HITLOG").is_err() { return; }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if LAST.swap(now, Ordering::SeqCst) == now { return; }
    let rel = cursor_in_window(w);
    let pts = cursor_points();
    let rects = HIT.lock().map(|h| h.clone()).unwrap_or_default();
    let line = format!("{now} cursor_pts={:?} in_window={:?} inside={inside} rects={} first={:?}\n",
        pts.map(|(x, y)| (x.round(), y.round())), rel.map(|(x, y)| (x.round(), y.round())), rects.len(), rects.first());
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/grillme-hit.log") { let _ = f.write_all(line.as_bytes()); }
}

/// "Press Esc anytime to leave" must hold even when another app has the
/// keyboard (the forge floats over other apps, and clicks pass through to
/// them). While the forge is up, Esc is a system-wide shortcut that tells the
/// page to leave; it's released the moment the forge ends.
fn escape_anywhere(app: &AppHandle, on: bool) {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};
    let esc = Shortcut::new(None, Code::Escape);
    let gs = app.global_shortcut();
    if !on {
        let _ = gs.unregister(esc);
        return;
    }
    let _ = gs.on_shortcut(esc, |app, _, ev| {
        if ev.state() == ShortcutState::Pressed {
            let _ = app.emit_to("main", "forge-escape", ());
        }
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
    escape_anywhere(&app, false);
    crate::blur::remove(&app);
    let Some(main) = app.get_webview_window("main") else { return };
    OVERLAY.store(false, Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(60));
    let _ = main.set_ignore_cursor_events(false);
    let _ = main.set_always_on_top(false);
    let _ = main.set_decorations(true);
    // turning decorations back on gives a plain title bar: the app's own top
    // bar should sit beside the window buttons, as at a normal launch
    #[cfg(target_os = "macos")]
    let _ = main.set_title_bar_style(tauri::TitleBarStyle::Overlay);
    let _ = main.set_shadow(true);
    restore(&main);
    crate::apply_glass(&main);
    let _ = main.set_focus();
}

/// "Finish setup" from inside the app: back to the see-through setup overlay.
#[tauri::command(async)]
pub fn forge_window_enter(app: AppHandle) {
    let Some(main) = app.get_webview_window("main") else { return };
    let w = main.clone();
    let _ = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        let _ = window_vibrancy::clear_vibrancy(&w);
        enter(&w);
    });
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
    #[test]
    fn a_paused_setup_resumes_at_launch() {
        use serde_json::json;
        assert!(first_run(&json!({"firstRunStep": "done", "firstRunPaused": "tools"})));
        assert!(!first_run(&json!({"firstRunStep": "done", "firstRunPaused": null})));
        assert!(first_run(&json!({"firstRunStep": "setup"})));
    }

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
