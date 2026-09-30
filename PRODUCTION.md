# Grill Me → production

How Grill Me goes from "runs on Aryan's Mac" to "anyone can download it and use it on their own time". Last updated 2026-09-29.

## The short version

Grill Me is **local-first**. Every session runs on the user's own Claude subscription, and all state lives in `~/.grillme` on their Mac. So **we have no servers to run and no per-user cost**, and it can be free forever. Going to production is not about backend work. It comes down to four things:

1. **Trust**: a signed app that never edits people's repos or leaks anything.
2. **Install**: one download with auto-updates, plus a setup check that says what's missing.
3. **Team**: rooms that are safe on café Wi-Fi and work across networks.
4. **MCP**: the claude.ai ↔ sessions bridge, made standard and safe enough for strangers.

## Done (Sept 29–30)

| PR | What | Why it mattered |
|---|---|---|
| #145 | Room code throttle (10 wrong codes / 10 min per IP → 429, no oracle); `/room/create` loopback-only | Anyone on the same Wi-Fi could brute-force the 5-char code or **take over the room** |
| #146, #150 | CI on every PR: build, 380 vitest, MCP parse, 128 cargo tests; Rust job only when the backend changes | Nothing ran automatically before. The repo is private, so macOS minutes bill 10×; the split cuts frontend PRs to about 1 billed minute |
| #147 | **Settings → Setup check**: claude, git, node, gh, tailscale, control API, each with a one-click copy of the fix command; launch toast when something required is missing | New users hit silent failures |
| #148 | MCP tool annotations (`title`, `readOnlyHint`, …) plus a real stdio test | Clients skip permission prompts on reads and flag the writes |
| #149 | Release workflow: bump version → tag → universal `.dmg` on a draft GitHub Release; signing turns on automatically once the secrets exist | There was no way to hand anyone a build |
| #151 | Hooks moved to `.claude/settings.local.json` (git-excluded); the playbook comes through a SessionStart hook; old leaked files cleaned up | **Blocker**: we were committing `/Users/aryanmotgi/...` paths into people's repos and editing their `CLAUDE.md` |
| #153 | Our hooks are recognized by the `~/.grillme` root | Hooks written under another project would otherwise run twice |
| #154 | **Copy diagnostics** (versions + setup check; no chats, paths or secrets) | Bug reports people can actually send |
| #155 | **Team brain**: goal and notes sync across the room (append-only `brain.json`; the newest goal wins) | Every teammate's Claude and claude.ai now see the same team goal |
| #156 | MCP **`ship_status`** + test results in `whats_new` (`run_tests` saves them to `tests.json`) | Claude can say "session B is red, don't ship it" |
| #157 | **Remove from my repos**: clean uninstall of hooks and `/ship` | Nobody should have to hand-clean their repos |
| #158 | MCP **per-project scoping**: `project` arg on every tool, `list_projects`, "Copy project instructions"; writes land in the project they came from | A hackathon's claude.ai Project only sees that hackathon. Also fixed questions landing in whatever project was open |
| #159 | API + room servers: a thread per connection, plus timeouts | One stalled client could freeze the API (no timeout at all) or the whole room |
| #160 | **First-run consent** screen; hooks install only after "Got it" | Strangers see what we add before we touch their repos |
| #162 | Consent dialog opaque + plain words; own files never count as claims; banner clears traffic lights | First native run of #160 showed all three |
| #163 | **Flow view**: the bridge drawn as a map — Claude, brain, sessions, and every item in flight with its one action | The bridge was an invisible side panel; now it's the picture of who's talking to whom |
| #164 | **Teammates' sessions in Flow**: each Grill Me shares a session digest (title, status, branch, tests; never the chat) over the room; `team_status` uses it | You could not see what teammates were working on |
| #165 | **Team bridge**: hand-offs, questions and answers routed between teammates' Grill Mes; approval on both ends; `send_to_coder("Maya / API")` | Your Claude can now task a teammate's session, and answer their coders' questions |

## Decisions only you can make

1. **Apple Developer ID ($99/yr).** Without it, macOS blocks the app on other Macs: they have to right-click → Open and click through a warning. That's fine for teammates and a deal-breaker for the public. Once you have it, add the 6 secrets listed at the top of `.github/workflows/release.yml` and every release is signed and notarized.
2. **Open source or not.** Recommendation: **MIT on a public repo.** It's free for everyone, CI minutes become free (public repos get unlimited Linux and macOS minutes), people trust local-first apps they can read, and it gives you a Homebrew cask plus word of mouth. The main downside is that anyone can fork it.
3. **Name.** The bundle is `grill-me` (`productName`). "Grill Me" reads better in Finder and the Dock. Renaming changes the app path, so update `GRILL_APP` in `~/.zshrc` at the same time.

## Roadmap

### Phase 1: Private beta (teammates, friends). About a week.

- [ ] **First tagged release, v0.2.0**: bump the version in `tauri.conf.json`, `package.json` and `Cargo.toml`, push the tag, check the draft, publish.
- [ ] **Auto-update** (`tauri-plugin-updater` + `latest.json` on GitHub Releases). Needs an updater keypair: `npx tauri signer generate`, with the private key kept as a repo secret. Without this, every fix means a manual re-download.
- [x] ~~**Diagnostics**~~ (#154; a rotating app log is still to do): a Settings → Setup check → "Copy diagnostics" button (versions, doctor results, the last 50 app log lines, **no** transcripts or secrets). Plus a rotating `~/.grillme/logs/app.log`. Bug reports are useless without this.
- [x] ~~**Uninstall**~~ (#157): strips our hooks from `settings.local.json` (`strip_ours` already exists) and deletes `ship.md` if it has our marker.
- [ ] **Release notes on each GitHub Release**: generate them with the existing `release_notes` command (git log + merged PRs → Claude summary) and paste them into the draft.
- [x] ~~**Consent on first project**~~ (#160): one screen listing exactly what Grill Me installs (hooks in `settings.local.json`, `/ship` command, read access to `~/.claude/projects` transcripts), with a "Got it". Strangers need to see this before we touch anything.

### Phase 2: Public beta. 2–4 weeks.

- [ ] **Signing + notarization** (decision 1).
- [ ] **Drop the Node requirement.** The MCP bridge (`grillme-mcp.mjs`) needs Node, but Claude Code's native installer doesn't, so many users won't have it. Two options:
  - **(a) Recommended:** ship it as a Tauri sidecar built with `bun build --compile`. About 1 hour of work, adds ~55 MB, zero behavior change.
  - (b) Port the ~1,000 lines to Rust behind a `grill-me --mcp` mode of the app binary. Smallest and fastest, but a real rewrite.
- [ ] **Content-Security-Policy.** `tauri.conf.json` has `"csp": null`. Set `default-src 'self'` plus what's needed: `ipc:` and `http://ipc.localhost` for connect, localhost frames for Preview, `'unsafe-inline'` styles. Test every view in the built app before merging; the claude.ai child webview is separate and unaffected.
- [x] ~~**Hardening the local listeners.**~~ (#159) `4517` (API) and `4518` (room) handle one connection at a time with a 5 s timeout, so one slow client stalls everyone. Move to one thread per connection with a small cap.
- [ ] **Homebrew cask** (`brew install --cask grill-me`) plus a one-page site: what it is, a 30-second GIF, download, and "needs Claude Code".
- [ ] **Privacy page**, plain words: what's read (transcripts, git), what leaves the Mac (only what the user turns on: the claude.ai connection, phone pings through ntfy.sh, team rooms), and no telemetry.
- [ ] **Split `lib.rs`** (5,400 lines, 65 commands) into `pty`, `git`, `hooks`, `api` and `usage` modules before outside contributors show up.

### Phase 3: Make it better than anything else

**MCP (the claude.ai ↔ sessions bridge)**
- [ ] **OAuth for the remote connector** instead of a secret in the URL. claude.ai custom connectors support OAuth 2.1 with dynamic client registration. A secret URL leaks through screenshots, browser history and shared chats. OAuth gives per-device tokens you can revoke one at a time, and "Sign in to Grill Me" becomes a consent screen served by the app.
- [x] ~~**Per-project scoping**~~ (#158): an optional `project` argument on every tool, plus a "Copy project instructions" button that pins a claude.ai Project to one Grill Me project. That way a hackathon's Claude project only ever sees that hackathon's sessions.
- [x] ~~**Workflow tools**~~ (`ship_status` in #156; `preview_url` still to do), read-only: `test_status` (last auto-test run per session), `ship_status` (what's ready or blocked), `preview_url`. Claude can then say "session B's tests are red; don't ship it."
- [ ] **`outputSchema` / structured results** for `whats_new` and `catch_up`, so clients can render cards instead of walls of text.
- [ ] **Resources + subscriptions**: expose each session as an MCP resource and send `resources/updated` when it finishes a turn. That's push instead of polling, in clients that support it.
- [ ] **Elicitation for the grill gate** in Claude Code: the server asks the user directly to explain the plan back, rather than trusting the model to relay it.

**Team coordination**
- [x] ~~**Share the brain across the team.**~~ (#155) Rooms already sync `tasks`, `messages` and `decisions`. Add the **goal, notes and approved plans** (the shared parts of `bridge.json`) so every teammate's Claude, and their claude.ai, sees the same team goal.
- [x] ~~**"What I'm on" digests.**~~ (#164) Each teammate opts in to share a one-line-per-session summary (never raw transcripts) through the room. `team_status` in MCP then answers "what is everyone doing?" for real.
- [x] **Team bridge** (#165): hand-offs and questions between teammates' sessions, approved on both ends. Not yet exercised across two physical Macs — do that with a teammate before the public beta.
- [ ] **Cross-machine conflict warnings.** File claims are local today. Syncing them through the room gives a "Maya's session is editing `api.ts` too" banner.
- [ ] **Tailscale identity instead of codes.** When hosting over a tailnet, bind the room to the Tailscale IP only and use `tailscale whois` for names. No code to read aloud, and nothing exposed on the LAN.
- [ ] **Host handoff.** If the host quits, the longest-connected member becomes host with the last state. Right now the host is a single point of failure.
- [ ] *Later, only if people ask:* a hosted relay for teams without Tailscale. That means servers, accounts and cost, which breaks "free forever", so it would be a paid add-on.

**Features**
- [ ] **Playbook gallery**: share and import hackathon playbooks (`~/.grillme/skills/*.md`) as files or links. Rewrite the six defaults from your real process first.
- [ ] **Demo recorder**: a one-click screen recording of Preview plus a narrated diff summary, made for hackathon submissions.
- [ ] **Usage over time**: per-project token and cost history from the transcripts (per-session data is already parsed), so you know what each hackathon cost.
- [ ] **Session templates**: "frontend", "API" and "tests" presets (model, prompt, playbook, worktree naming) for fan-out.

## How we ship from here

- Every change: a branch → PR → CI green → squash-merge (as now).
- Every release: bump the version in 3 files → `git tag vX.Y.Z && git push --tags` → check the draft release → publish.
- Security-sensitive PRs (listeners, MCP remote, hooks) get a focused review pass before merge.

## Security notes to keep in mind

- With per-project scoping (#158), a claude.ai connection can read **any** Grill Me project on the Mac, not only the open one. The connection is still off by default and read-only unless proposals are on. If per-project remote access is ever needed, add an allowlist of projects to the remote server.
- The team room is still LAN or tailnet HTTP with a 5-char code. It's throttled now (#145), but traffic isn't encrypted on plain Wi-Fi. Prefer Tailscale for rooms (see "Tailscale identity instead of codes").
