// ---------------------------------------------------------------------------
// When the app window starts loading the real app. It opens on boot.html,
// which calls `boot_wait`; that returns once `release` is called (by the
// launch animation, at its quiet moment) or after a timeout, whichever is
// first. Keeps the heavy app load from stuttering the animation.
// ---------------------------------------------------------------------------

use std::sync::{Condvar, Mutex};
use std::time::Duration;

static GATE: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());
const MAX_WAIT: Duration = Duration::from_secs(5);

pub fn release() {
    let (lock, cv) = &GATE;
    if let Ok(mut open) = lock.lock() {
        *open = true;
        cv.notify_all();
    }
}

fn wait(max: Duration) -> bool {
    let (lock, cv) = &GATE;
    let Ok(guard) = lock.lock() else { return true };
    cv.wait_timeout_while(guard, max, |open| !*open).map(|(g, _)| *g).unwrap_or(true)
}

/// boot.html waits here (off the main thread) before loading the app.
#[tauri::command(async)]
pub fn boot_wait() -> bool {
    wait(MAX_WAIT)
}

/// The launch animation: "start loading the app now".
#[tauri::command]
pub fn boot_release() {
    release();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waits_until_released_or_times_out() {
        // never released: gives up after the timeout
        let t = std::time::Instant::now();
        assert!(!wait(Duration::from_millis(60)));
        assert!(t.elapsed() >= Duration::from_millis(50));
        // released from another thread: returns right away
        let h = std::thread::spawn(|| { std::thread::sleep(Duration::from_millis(30)); release(); });
        assert!(wait(Duration::from_secs(2)));
        h.join().unwrap();
        // stays open afterwards
        assert!(wait(Duration::from_millis(1)));
    }
}
