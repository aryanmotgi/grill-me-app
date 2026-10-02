// ---------------------------------------------------------------------------
// The forge's soft blur: real macOS vibrancy, but only behind what the forge
// draws (its words, options, diagrams), never the whole window.
//
// A web page's own blur can't reach other apps, so this is native: one
// NSVisualEffectView sits behind the (transparent) web view, and its
// `maskImage` decides where it shows. The page paints that mask at low
// resolution — soft blobs where its elements are, fading in and out, growing
// as text types — and macOS stretches it over the window, which is what
// keeps the edges soft instead of boxy.
// ---------------------------------------------------------------------------

use base64::Engine;
use tauri::{AppHandle, WebviewWindow};

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::{AllocAnyThread, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSImage, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode};
    use objc2_foundation::NSData;
    use std::cell::RefCell;

    thread_local! {
        static VIEW: RefCell<Option<Retained<NSVisualEffectView>>> = const { RefCell::new(None) };
    }

    /// Put the (hidden until masked) blur view behind the web view.
    /// Must run on the main thread.
    pub fn install(ns_view: *mut std::ffi::c_void) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        if ns_view.is_null() { return }
        let host: &NSView = unsafe { &*(ns_view as *const NSView) };
        let v = NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), host.bounds());
        v.setMaterial(NSVisualEffectMaterial::HUDWindow);
        v.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        v.setState(NSVisualEffectState::Active);
        v.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
        v.setHidden(true);
        host.addSubview_positioned_relativeTo(&v, NSWindowOrderingMode::Below, None);
        VIEW.with(|c| *c.borrow_mut() = Some(v));
    }

    /// Show the blur where the mask (a PNG; its alpha) says. Main thread.
    pub fn set_mask(png: &[u8]) {
        VIEW.with(|c| {
            let Some(v) = &*c.borrow() else { return };
            let data = NSData::with_bytes(png);
            let Some(img) = NSImage::initWithData(NSImage::alloc(), &data) else { return };
            // stretched over the whole view: a small, soft mask stays soft
            img.setSize(v.bounds().size);
            unsafe { v.setMaskImage(Some(&img)) };
            v.setHidden(false);
        });
    }

    pub fn clear() {
        VIEW.with(|c| {
            if let Some(v) = c.borrow_mut().take() {
                v.removeFromSuperview();
            }
        });
    }
}

/// Called on the main thread when the forge window opens.
pub fn install(win: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        if let Ok(h) = win.window_handle() {
            if let RawWindowHandle::AppKit(a) = h.as_raw() {
                mac::install(a.ns_view.as_ptr());
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = win;
}

/// Remove the blur view (the forge has ended).
pub fn remove(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(mac::clear);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// The page's latest mask: a small PNG (base64) whose alpha is where to blur.
#[tauri::command]
pub fn forge_blur_mask(app: AppHandle, png_base64: String) -> Result<(), String> {
    let raw = png_base64.trim_start_matches("data:image/png;base64,");
    let bytes = base64::engine::general_purpose::STANDARD.decode(raw).map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 || !bytes.starts_with(b"\x89PNG") {
        return Err("not a PNG".into());
    }
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(move || mac::set_mask(&bytes)).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, bytes);
    Ok(())
}
