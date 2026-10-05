// ---------------------------------------------------------------------------
// The Grill Me pill: a small always-on-top bar that floats over whatever
// you're working in (terminal, editor, browser), so you don't have to keep
// the app in front.
//
//   pill_open / pill_close   the window: see-through, no title bar, above
//                            other apps, on every desktop and over full-screen
//                            apps, never taking focus, and left out of screen
//                            shares and recordings
//   pill_hit_rects           where the pill draws; everywhere else clicks go
//                            straight through to the app behind (same trick
//                            as the forge), and the page hears when the
//                            cursor comes near so it can fade out of the way
//   pill_focus               let the pill take the keyboard while you type in
//                            it (command bar, mini chat), then give it back
//   placement                docked to a screen edge (left by default; drop
//                            it near the other edge to move it) or floating
//                            wherever you drop it; remembered
//   "while you were away"    no input for 10 minutes, then input again: the
//                            app hears how long you were gone
//   pill_say                 spoken updates through the Mac's own voice
//   shortcuts                ⌃⌥P shows or hides it, ⌃⌥K opens its command
//                            bar, ⌃⌥Y says yes to "trust this folder?",
//                            ⌃⌥O opens the session that's waiting on you
//
// No macOS permission is needed for any of this.
// ---------------------------------------------------------------------------

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// wide enough for the rail plus a menu and its submenu beside it; the
/// empty part is see-through and lets clicks through
pub const W: f64 = 580.0;
pub const H: f64 = 560.0;
/// gap kept from a docked screen edge
const MARGIN: f64 = 8.0;
/// how close (window edge to screen edge) counts as "dropped on the edge"
const SNAP: f64 = 140.0;
/// no input this long counts as away
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const AWAY_SECS: f64 = 600.0;

static HIT: Mutex<Vec<[f64; 4]>> = Mutex::new(Vec::new());
/// The window's top-left in global points, kept up to date on moves, so the
/// 60-times-a-second hover check never has to ask the main thread.
static ORIGIN: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));
static ON: AtomicBool = AtomicBool::new(false);
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
static WATCHING: AtomicBool = AtomicBool::new(false);
/// "Floating" placement: stay where dropped, never dock to an edge.
static FLOATING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    #[default]
    Right,
    Left,
    Free,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Place {
    pub edge: Edge,
    pub x: f64,
    pub y: f64,
}

/// A rectangle in logical points: x, y, width, height.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Where the window goes after it was dropped at (x, y) inside `area`:
/// docked to the left or right edge when it lands near one (unless it's set
/// to float), otherwise where it was dropped, always kept fully on screen.
pub fn snap(x: f64, y: f64, area: Area, floating: bool) -> Place {
    let max_y = (area.y + area.h - H).max(area.y);
    let y = y.clamp(area.y + MARGIN.min(area.h), max_y);
    let right_gap = area.x + area.w - (x + W);
    let left_gap = x - area.x;
    if floating {
        Place { edge: Edge::Free, x: x.clamp(area.x, area.x + area.w - W), y }
    } else if right_gap <= SNAP {
        Place { edge: Edge::Right, x: area.x + area.w - W - MARGIN, y }
    } else if left_gap <= SNAP {
        Place { edge: Edge::Left, x: area.x + MARGIN, y }
    } else {
        Place { edge: Edge::Free, x: x.clamp(area.x, area.x + area.w - W), y }
    }
}

/// The first spot: docked to the left edge, a third of the way down.
pub fn default_place(area: Area) -> Place {
    snap(area.x, area.y + area.h / 3.0 - 60.0, area, false)
}

/// Is the point inside any of the areas?
pub fn hits(rects: &[[f64; 4]], x: f64, y: f64) -> bool {
    rects.iter().any(|r| x >= r[0] && y >= r[1] && x <= r[0] + r[2] && y <= r[1] + r[3])
}

/// How far the point is from the nearest area (0 inside one).
pub fn distance(rects: &[[f64; 4]], x: f64, y: f64) -> f64 {
    rects.iter().map(|r| {
        let dx = (r[0] - x).max(0.0).max(x - (r[0] + r[2]));
        let dy = (r[1] - y).max(0.0).max(y - (r[1] + r[3]));
        (dx * dx + dy * dy).sqrt()
    }).fold(f64::INFINITY, f64::min)
}

fn place_file() -> std::path::PathBuf {
    crate::grillme_root().join("pill.json")
}

fn saved_place() -> Option<Place> {
    serde_json::from_str(&std::fs::read_to_string(place_file()).ok()?).ok()
}

fn work_area(win: &WebviewWindow) -> Option<Area> {
    let mon = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten())?;
    let s = mon.scale_factor();
    let p = mon.work_area().position.to_logical::<f64>(s);
    let z = mon.work_area().size.to_logical::<f64>(s);
    Some(Area { x: p.x, y: p.y, w: z.width, h: z.height })
}

/// Tell the page which side it's docked on (it lines the pill up with it).
fn announce(win: &WebviewWindow, place: Place) {
    let _ = win.emit("pill-place", place);
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::runtime::AnyObject;
    use objc2::{define_class, msg_send, ClassType, MainThreadOnly};
    use objc2_app_kit::NSPanel;

    define_class!(
        // A borderless panel that can take the keyboard (to type in the
        // pill) without making Grill Me the active app, so the big window
        // never jumps in front of what you're working in. Spotlight and
        // Raycast work the same way.
        #[unsafe(super(NSPanel))]
        #[thread_kind = MainThreadOnly]
        #[name = "GrillMePillPanel"]
        struct PillPanel;

        impl PillPanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key(&self) -> bool { true }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main(&self) -> bool { false }
        }
    );

    /// Turn the window into the non-activating panel above.
    fn make_panel(w: &AnyObject) {
        unsafe {
            AnyObject::set_class(w, PillPanel::class());
            let mask: usize = msg_send![w, styleMask];
            // NSWindowStyleMaskNonactivatingPanel
            let _: () = msg_send![w, setStyleMask: mask | (1 << 7)];
            let _: () = msg_send![w, setFloatingPanel: true];
            // only take the keyboard when something that types is clicked
            let _: () = msg_send![w, setBecomesKeyOnlyIfNeeded: true];
            let _: () = msg_send![w, setWorksWhenModal: true];
        }
    }

    /// Take the keyboard (the command bar, a message box) without
    /// activating Grill Me, or give it back.
    pub fn key(ns_window: *mut std::ffi::c_void, on: bool) {
        if ns_window.is_null() { return }
        let w: &AnyObject = unsafe { &*(ns_window as *const AnyObject) };
        unsafe {
            if on {
                let _: () = msg_send![w, makeKeyWindow];
            } else {
                let _: () = msg_send![w, resignKeyWindow];
            }
        }
    }

    /// Become the non-activating panel, float above other apps on every
    /// desktop and over full-screen apps, and stay out of window cycling,
    /// screen shares and recordings. Main thread only.
    pub fn float(ns_window: *mut std::ffi::c_void) {
        if ns_window.is_null() { return }
        let w: &AnyObject = unsafe { &*(ns_window as *const AnyObject) };
        // can join all spaces | stationary | ignores cycle | full-screen auxiliary
        let behavior: usize = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8);
        make_panel(w);
        unsafe {
            let _: () = msg_send![w, setCollectionBehavior: behavior];
            // the status-bar level: above normal and floating windows
            let _: () = msg_send![w, setLevel: 25isize];
            // NSWindowSharingNone: left out of screen shares and recordings
            let _: () = msg_send![w, setSharingType: 0usize];
            let _: () = msg_send![w, setHidesOnDeactivate: false];
        }
    }

    /// Seconds since the last keyboard or mouse input anywhere.
    pub fn idle_secs() -> f64 {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
        }
        // combined session state, any input event
        unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) }
    }
}

fn native_float(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let Some(win) = app.get_webview_window("pill") else { return };
        let ptr = win.ns_window().map(|p| p as usize).unwrap_or(0);
        let _ = app.run_on_main_thread(move || mac::float(ptr as *mut std::ffi::c_void));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[tauri::command]
pub fn pill_open(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("pill") {
        let _ = w.show();
        ON.store(true, Ordering::SeqCst);
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(&app, "pill", WebviewUrl::App("pill.html".into()))
        .title("Grill Me pill")
        .inner_size(W, H)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(false)
        .accept_first_mouse(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    let place = match (saved_place(), work_area(&win)) {
        (Some(p), Some(a)) => snap(p.x, p.y, a, p.edge == Edge::Free),
        (None, Some(a)) => default_place(a),
        (Some(p), None) => p,
        (None, None) => Place { edge: Edge::Left, x: 8.0, y: 200.0 },
    };
    FLOATING.store(place.edge == Edge::Free, Ordering::SeqCst);
    let _ = win.set_position(LogicalPosition::new(place.x, place.y));
    remember_origin(&win);
    native_float(&app);
    ON.store(true, Ordering::SeqCst);
    watch_cursor(win.clone());
    watch_moves(&win);
    watch_away(app.clone());
    shortcuts(&app, true);
    let _ = win.show();
    announce(&win, place);
    Ok(())
}

#[tauri::command]
pub fn pill_close(app: AppHandle) {
    ON.store(false, Ordering::SeqCst);
    shortcuts(&app, false);
    if let Some(w) = app.get_webview_window("pill") {
        let _ = w.destroy();
    }
}

/// Hide or show without closing (⌃⌥P, the hide button).
#[tauri::command]
pub fn pill_visible(app: AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window("pill") {
        let _ = if on { w.show() } else { w.hide() };
    }
}

/// Edge (docks to the nearest side) or floating (stays where you drop it).
#[tauri::command]
pub fn pill_placement(app: AppHandle, floating: bool) {
    FLOATING.store(floating, Ordering::SeqCst);
    let Some(w) = app.get_webview_window("pill") else { return };
    let (Ok(scale), Ok(pos)) = (w.scale_factor(), w.outer_position()) else { return };
    let p = pos.to_logical::<f64>(scale);
    let Some(area) = work_area(&w) else { return };
    let place = snap(p.x, p.y, area, floating);
    let _ = w.set_position(LogicalPosition::new(place.x, place.y));
    remember_origin(&w);
    let _ = std::fs::write(place_file(), serde_json::to_string(&place).unwrap_or_default());
    announce(&w, place);
}

#[tauri::command]
pub fn pill_hit_rects(rects: Vec<[f64; 4]>) {
    if let Ok(mut h) = HIT.lock() {
        *h = rects.into_iter().take(64).collect();
    }
}

/// Let the pill take the keyboard (typing in it) or give it back, without
/// making Grill Me the active app.
#[tauri::command]
pub fn pill_focus(app: AppHandle, on: bool) {
    let Some(win) = app.get_webview_window("pill") else { return };
    #[cfg(target_os = "macos")]
    {
        let ptr = win.ns_window().map(|p| p as usize).unwrap_or(0);
        let _ = app.run_on_main_thread(move || mac::key(ptr as *mut std::ffi::c_void, on));
    }
    #[cfg(not(target_os = "macos"))]
    if on {
        let _ = win.set_focus();
    }
}

/// Spoken updates, in the Mac's own voice. One sentence; never queued up.
#[tauri::command]
pub fn pill_say(text: String) {
    let t: String = text.chars().filter(|c| !c.is_control()).take(200).collect();
    if t.trim().is_empty() { return }
    let _ = std::process::Command::new("/usr/bin/killall").arg("say").output();
    let _ = std::process::Command::new("/usr/bin/say").args(["-r", "190", &t]).spawn();
}

fn remember_origin(w: &WebviewWindow) {
    let (Ok(scale), Ok(pos)) = (w.scale_factor(), w.inner_position()) else { return };
    let p = pos.to_logical::<f64>(scale);
    if let Ok(mut o) = ORIGIN.lock() { *o = (p.x, p.y); }
}

/// Click-through everywhere the pill doesn't draw, and "near" for fading.
/// Runs about 60 times a second on its own thread with nothing but a cursor
/// read and a lock, so hovering responds right away.
fn watch_cursor(w: WebviewWindow) {
    std::thread::spawn(move || {
        let mut through: Option<bool> = None;
        let mut near: Option<bool> = None;
        while ON.load(Ordering::SeqCst) {
            let (inside, close) = (|| {
                let (ox, oy) = *ORIGIN.lock().ok()?;
                let (cx, cy) = crate::forge::cursor_points()?;
                let (x, y) = (cx - ox, cy - oy);
                let rects = HIT.lock().ok()?;
                let d = distance(&rects, x, y);
                Some((hits(&rects, x, y), d > 0.0 && d < 56.0))
            })()
            .unwrap_or((true, false));
            if through != Some(!inside) {
                let _ = w.set_ignore_cursor_events(!inside);
                through = Some(!inside);
            }
            if near != Some(close) {
                let _ = w.emit("pill-near", close);
                near = Some(close);
            }
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    });
}

/// After the pill is dragged somewhere: dock it if it landed near an edge,
/// remember where it is.
fn watch_moves(win: &WebviewWindow) {
    use std::sync::atomic::AtomicU64;
    static MOVE_SEQ: AtomicU64 = AtomicU64::new(0);
    let w = win.clone();
    win.on_window_event(move |ev| {
        if !matches!(ev, tauri::WindowEvent::Moved(_)) { return }
        remember_origin(&w);
        let seq = MOVE_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
        let w = w.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(350));
            // only the last move of a drag settles it
            if MOVE_SEQ.load(Ordering::SeqCst) != seq { return }
            let (Ok(scale), Ok(pos)) = (w.scale_factor(), w.outer_position()) else { return };
            let p = pos.to_logical::<f64>(scale);
            let Some(area) = work_area(&w) else { return };
            let place = snap(p.x, p.y, area, FLOATING.load(Ordering::SeqCst));
            if (place.x - p.x).abs() > 0.5 || (place.y - p.y).abs() > 0.5 {
                // this move fires another Moved, which settles to the same place
                let _ = w.set_position(LogicalPosition::new(place.x, place.y));
            }
            let _ = std::fs::write(place_file(), serde_json::to_string(&place).unwrap_or_default());
            announce(&w, place);
        });
    });
}

/// "While you were away": tell both windows when you come back after ten
/// minutes without any input.
fn watch_away(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if WATCHING.swap(true, Ordering::SeqCst) { return }
        std::thread::spawn(move || {
            let mut away_since: Option<std::time::SystemTime> = None;
            while ON.load(Ordering::SeqCst) {
                let idle = mac::idle_secs();
                match away_since {
                    None if idle >= AWAY_SECS => {
                        away_since = Some(std::time::SystemTime::now() - std::time::Duration::from_secs_f64(idle));
                    }
                    Some(since) if idle < 5.0 => {
                        let secs = since.elapsed().map(|d| d.as_secs()).unwrap_or(0);
                        let started = since.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                        let _ = app.emit("pill-back", serde_json::json!({ "awaySecs": secs, "since": started }));
                        away_since = None;
                    }
                    _ => {}
                }
                std::thread::sleep(std::time::Duration::from_secs(5));
            }
            WATCHING.store(false, Ordering::SeqCst);
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// ⌃⌥P shows or hides the pill; ⌃⌥K opens its command bar; ⌃⌥Y and ⌃⌥O
/// answer or open whatever is waiting on you.
fn shortcuts(app: &AppHandle, on: bool) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
    let mods = Some(Modifiers::CONTROL | Modifiers::ALT);
    let toggle = Shortcut::new(mods, Code::KeyP);
    let bar = Shortcut::new(mods, Code::KeyK);
    let yes = Shortcut::new(mods, Code::KeyY);
    let go = Shortcut::new(mods, Code::KeyO);
    let gs = app.global_shortcut();
    for s in [toggle, bar, yes, go] {
        let _ = gs.unregister(s);
    }
    if !on { return }
    // one key, from any app: answer "trust this folder?", or jump to the
    // session that's waiting on you
    for (s, what) in [(yes, "yes"), (go, "open-needs")] {
        let _ = gs.on_shortcut(s, move |app, _, ev| {
            if ev.state() == ShortcutState::Pressed {
                let _ = app.emit_to("pill", "pill-key", what);
            }
        });
    }
    let _ = gs.on_shortcut(toggle, |app, _, ev| {
        if ev.state() != ShortcutState::Pressed { return }
        if let Some(w) = app.get_webview_window("pill") {
            let _ = if w.is_visible().unwrap_or(false) { w.hide() } else { w.show() };
        }
    });
    let _ = gs.on_shortcut(bar, |app, _, ev| {
        if ev.state() != ShortcutState::Pressed { return }
        if let Some(w) = app.get_webview_window("pill") {
            let _ = w.show();
            let _ = w.emit("pill-key", "command");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area { x: 0.0, y: 25.0, w: 1440.0, h: 875.0 };

    #[test]
    fn docks_near_an_edge_and_stays_on_screen() {
        // dropped near the right edge: docked right
        assert_eq!(snap(1440.0 - W - 60.0, 300.0, SCREEN, false), Place { edge: Edge::Right, x: 1440.0 - W - MARGIN, y: 300.0 });
        // near the left: docked left
        assert_eq!(snap(90.0, 300.0, SCREEN, false).edge, Edge::Left);
        assert_eq!(snap(90.0, 300.0, SCREEN, false).x, MARGIN);
        // in the middle: stays where it was dropped
        assert_eq!(snap(500.0, 300.0, SCREEN, false), Place { edge: Edge::Free, x: 500.0, y: 300.0 });
        // too low: pulled up so the whole window fits
        assert_eq!(snap(500.0, 2000.0, SCREEN, false).y, 25.0 + 875.0 - H);
        // above the menu bar: pushed under it
        assert_eq!(snap(500.0, -50.0, SCREEN, false).y, 25.0 + MARGIN);
        assert_eq!(default_place(SCREEN).edge, Edge::Left);
        // floating: never docks, even right at an edge
        assert_eq!(snap(1440.0 - W - 10.0, 300.0, SCREEN, true).edge, Edge::Free);
    }

    #[test]
    fn hit_and_distance() {
        let r = [[10.0, 10.0, 100.0, 40.0]];
        assert!(hits(&r, 50.0, 20.0));
        assert!(!hits(&r, 5.0, 20.0));
        assert_eq!(distance(&r, 50.0, 20.0), 0.0);
        assert_eq!(distance(&r, 130.0, 20.0), 20.0);
        assert_eq!(distance(&[], 0.0, 0.0), f64::INFINITY);
    }

    #[test]
    fn place_reads_and_writes_as_json() {
        let p = Place { edge: Edge::Left, x: 8.0, y: 97.0 };
        let s = serde_json::to_string(&p).unwrap();
        assert_eq!(s, r#"{"edge":"left","x":8.0,"y":97.0}"#);
        assert_eq!(serde_json::from_str::<Place>(&s).unwrap(), p);
    }
}
