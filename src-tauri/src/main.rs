// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `grill-me --mcp …`: the MCP bridge / hook CLI. Runs before (and
    // instead of) Tauri — no window, no webview, starts in milliseconds.
    let mut args = std::env::args();
    if args.nth(1).as_deref() == Some("--mcp") {
        grill_me_lib::mcp::main(args.collect());
    }
    grill_me_lib::run()
}
