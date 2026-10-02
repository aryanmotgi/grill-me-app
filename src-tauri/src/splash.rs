// ---------------------------------------------------------------------------
// Launch animation window. The main window starts hidden (tauri.conf.json
// "visible": false). At startup we open a see-through, borderless "splash"
// window exactly over where the main window will appear; it plays the
// animation (src/splash), fills with the main window's real loading
// progress, then calls `splash_reveal` (show the app underneath) and
// `splash_close`. A watchdog shows the app anyway if the splash never does.
// ---------------------------------------------------------------------------

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const WATCHDOG_SECS: u64 = 12;

fn settings_path() -> std::path::PathBuf {
    crate::grillme_root().join("settings.json")
}

/// (play the animation?, "first" | "back", first name for "Welcome back")
pub fn plan(settings: &Value) -> (bool, &'static str, String) {
    let enabled = settings["launchAnimation"] != false;
    let mode = if settings["launchSeen"] == true { "back" } else { "first" };
    let name = settings["teamChatMe"]["name"].as_str().unwrap_or("")
        .split_whitespace().next().unwrap_or("").chars().take(40).collect();
    (enabled, mode, name)
}

/// Remember that the full animation has played, keeping every other setting.
fn mark_seen(path: &std::path::Path, mut settings: Value) {
    if settings["launchSeen"] == true || !settings.is_object() {
        return;
    }
    settings["launchSeen"] = json!(true);
    let tmp = path.with_extension("json.tmp");
    if let Ok(body) = serde_json::to_vec_pretty(&settings) {
        if std::fs::write(&tmp, body).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// settings.json, or {} for a brand-new install (or an unreadable file).
pub fn read_settings() -> Value {
    std::fs::read_to_string(settings_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}))
}

/// Called from `setup`: open the splash, or just show the app.
pub fn start(app: &AppHandle) {
    let path = settings_path();
    let raw = std::fs::read_to_string(&path).ok();
    let settings = read_settings();
    let (enabled, mode, name) = plan(&settings);
    let Some(main) = app.get_webview_window("main") else { return };
    // first run: no splash. The forge takes over the whole screen and plays
    // its own arrival (embers rise into the wordmark), so the app loads now.
    if crate::forge::first_run(&settings) {
        crate::boot::release();
        crate::forge::enter(&main);
        return;
    }
    if !enabled {
        crate::boot::release();
        show_main(app);
        return;
    }
    // only write when the file parsed (never clobber a corrupt one)
    if raw.is_some() && settings.is_object() {
        mark_seen(&path, settings.clone());
    }

    // cover exactly the frame the app window will open in
    let scale = main.scale_factor().unwrap_or(1.0);
    let size = main.outer_size().map(|s| s.to_logical::<f64>(scale)).unwrap_or(tauri::LogicalSize::new(1440.0, 900.0));
    let pos = main.outer_position().ok().map(|p| p.to_logical::<f64>(scale));
    let boot = json!({ "mode": mode, "name": name });
    let mut b = WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("splash.html".into()))
        .title("Grill Me")
        .initialization_script(&format!("window.__GRILLME_SPLASH__ = {boot};"))
        .inner_size(size.width, size.height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .accept_first_mouse(true)
        .focused(true);
    b = match pos { Some(p) => b.position(p.x, p.y), None => b.center() };
    if b.build().is_err() {
        crate::boot::release();
        show_main(app);
        return;
    }
    // never leave anyone stuck: macOS pauses animation in windows on another
    // Space or behind others, so the splash may never finish on its own.
    // After the watchdog the app is shown and the splash is always closed.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(WATCHDOG_SECS));
        if let Some(s) = handle.get_webview_window("splash") {
            show_main(&handle);
            let _ = s.destroy();
        }
    });
}

/// The box is opening: show the app underneath it (the splash stays on top).
#[tauri::command]
pub fn splash_reveal(app: AppHandle) {
    show_main(&app);
    // keep the splash above the app until it has faded out
    if let Some(s) = app.get_webview_window("splash") { let _ = s.set_focus(); }
}

/// The animation is over.
#[tauri::command]
pub fn splash_close(app: AppHandle) {
    show_main(&app);
    if let Some(s) = app.get_webview_window("splash") { let _ = s.destroy(); }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_from_settings() {
        assert_eq!(plan(&json!({})), (true, "first", String::new()));
        assert_eq!(plan(&json!({ "launchSeen": true, "teamChatMe": { "name": "Aryan Motgi" } })), (true, "back", "Aryan".into()));
        assert!(!plan(&json!({ "launchAnimation": false })).0);
    }

    #[test]
    fn marks_seen_without_losing_settings() {
        let dir = std::env::temp_dir().join(format!("grillme-splash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        let s = json!({ "theme": "monocode", "panelSizes": { "left": 1 } });
        std::fs::write(&p, s.to_string()).unwrap();
        mark_seen(&p, s);
        let back: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(back["launchSeen"], true);
        assert_eq!(back["theme"], "monocode");
        assert_eq!(back["panelSizes"]["left"], 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
