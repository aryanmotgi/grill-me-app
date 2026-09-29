import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useApp, ptyIdFor } from "../store";
import { notificationsSilenced } from "../lib/quietHours";
import { deliverBriefWhenReady } from "../lib/ptyReady";
import { sessionTitle } from "../lib/sessionTitle";
import {
  AUTOMATIONS, CATEGORIES, automationOn, dayKey, dueDaily, newTopic, withAutomation,
  type AutomationDef, type AutomationId,
} from "../lib/automations";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Automations page (nav → Automations) + the engine that runs them.
// Monocode-style: category pills, a card per automation, a switch on each.
// The engine watches session status transitions and a 30s clock.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

export interface TestResult { ok: boolean; ms: number; tail: string; cmd: string; at: number; sig: string; running?: boolean }

export const useTests = create<{ results: Record<string, TestResult> }>(() => ({ results: {} }));

const on = (id: AutomationId) => automationOn(useApp.getState().appSettings, id);

/** One alert, everywhere the user asked for it: OS banner + phone. */
export async function alertEverywhere(title: string, body: string, opts: { os?: boolean } = {}) {
  const st = useApp.getState();
  if (st.appSettings.muteAll) return;
  if (opts.os !== false && native() && !notificationsSilenced(st.appSettings)) {
    const n = await import("@tauri-apps/plugin-notification");
    if (await n.isPermissionGranted().catch(() => false)) n.sendNotification({ title, body });
  }
  const topic = st.appSettings.ntfyTopic;
  if (on("phone-pings") && typeof topic === "string" && native()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("phone_ping", { topic, title, body }).catch(() => {});
  }
}

function titleOf(id: string): string {
  const s = useApp.getState();
  const t = s.teammates.find((x) => x.id === id);
  return t ? sessionTitle(t, s.appSettings.sessionTitles) : id;
}

export async function runTestsFor(memberId: string, force = false) {
  const st = useApp.getState();
  const m = st.members.find((x) => x.id === memberId);
  if (!m || !native()) return;
  const prev = useTests.getState().results[memberId];
  if (prev?.running) return;
  useTests.setState((s) => ({ results: { ...s.results, [memberId]: { ...(prev ?? { ok: true, ms: 0, tail: "", cmd: "", at: 0, sig: "" }), running: true } } }));
  const { invoke } = await import("@tauri-apps/api/core");
  const command = typeof st.appSettings.testCommand === "string" && st.appSettings.testCommand.trim() ? st.appSettings.testCommand : null;
  try {
    const r = await invoke<{ skipped: boolean; sig: string; ok?: boolean; ms?: number; tail?: string; cmd?: string }>(
      "run_tests", { repoPath: m.repoPath, command, lastSig: force ? null : prev?.sig ?? null },
    );
    if (r.skipped && prev) {
      useTests.setState((s) => ({ results: { ...s.results, [memberId]: { ...prev, running: false } } }));
      return;
    }
    const res: TestResult = { ok: !!r.ok, ms: r.ms ?? 0, tail: r.tail ?? "", cmd: r.cmd ?? "", at: Date.now(), sig: r.sig };
    useTests.setState((s) => ({ results: { ...s.results, [memberId]: res } }));
    const name = titleOf(memberId);
    if (!res.ok && (prev?.ok ?? true)) {
      st.toast(`✗ Tests failing in ${name}`, "warn");
      void alertEverywhere("Tests failing", `${name}: ${res.cmd}`);
    } else if (res.ok && prev && !prev.ok) {
      st.toast(`✓ Tests passing again in ${name}`);
    }
  } catch (e) {
    useTests.setState((s) => {
      const { [memberId]: _drop, ...rest } = s.results;
      return { results: rest };
    });
    st.toast(`Auto-test: ${e}`, "warn");
  }
}

/** Mount once (App). */
export function useAutomations() {
  const waitingSince = useRef<Record<string, number>>({});
  const reminded = useRef<Record<string, boolean>>({});
  const bigSince = useRef<Record<string, number>>({});
  const nudgedAt = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!native()) return;
    let prev = new Map(useApp.getState().teammates.map((t) => [t.id, t.status]));
    const unsub = useApp.subscribe((s) => {
      for (const t of s.teammates) {
        const was = prev.get(t.id);
        if (was === "working" && t.status === "idle" && on("auto-test")) void runTestsFor(t.id);
        if (t.status === "needs-input" && was !== "needs-input") {
          waitingSince.current[t.id] = Date.now();
          reminded.current[t.id] = false;
          // the feed already shows the OS banner; the phone gets it here
          void alertEverywhere("Session needs you", `${titleOf(t.id)} is waiting on you`, { os: false });
        }
        if (t.status !== "needs-input") delete waitingSince.current[t.id];
      }
      prev = new Map(s.teammates.map((t) => [t.id, t.status]));
    });

    const tick = async () => {
      const st = useApp.getState();
      const now = Date.now();
      const { invoke } = await import("@tauri-apps/api/core");

      if (on("waiting-reminder")) {
        for (const [id, since] of Object.entries(waitingSince.current)) {
          if (!reminded.current[id] && now - since > 5 * 60_000) {
            reminded.current[id] = true;
            st.toast(`${titleOf(id)} has been waiting on you for 5 minutes`, "warn");
            void alertEverywhere("Still waiting", `${titleOf(id)} has been waiting 5 minutes`);
          }
        }
      }

      if (on("morning-standup")) {
        const at = typeof st.appSettings.standupAt === "string" ? st.appSettings.standupAt : "09:00";
        if (dueDaily(new Date(now), at, st.appSettings.standupLastDay as string | undefined, true)) {
          st.setAppSetting("standupLastDay", dayKey(new Date(now)));
          useApp.setState({ standupOpen: true });
          st.toast("Morning standup is ready — review and post it");
          void alertEverywhere("Morning standup", "Your standup is ready in Grill Me");
        }
      }

      if (on("catchup-ping")) {
        const last = typeof st.appSettings.catchupPingAt === "number" ? st.appSettings.catchupPingAt : now;
        if (!st.appSettings.catchupPingAt) st.setAppSetting("catchupPingAt", now);
        else if (now - last > 2 * 3_600_000) {
          st.setAppSetting("catchupPingAt", now);
          const digest = await invoke<string>("brain_digest", { since: last }).catch(() => "");
          if (digest && digest.trim() !== "Nothing new.") {
            st.toast("2-hour catch-up ready — open Brain");
            void alertEverywhere("Catch-up", "New work since 2 hours ago — open Brain");
          }
        }
      }

      if (on("commit-nudge")) {
        for (const t of st.teammates) {
          const m = st.members.find((x) => x.id === t.id);
          if (!m || (m.agent ?? "claude") !== "claude") continue;
          if (t.changes.length >= 10) {
            bigSince.current[t.id] ??= now;
            if (now - bigSince.current[t.id] > 30 * 60_000 && now - (nudgedAt.current[t.id] ?? 0) > 60 * 60_000 && t.status === "idle") {
              nudgedAt.current[t.id] = now;
              void deliverBriefWhenReady(ptyIdFor(t.id), "Please commit the work so far in small, clearly-described commits (don't push).\n");
              st.toast(`Asked ${titleOf(t.id)} to commit its ${t.changes.length} changed files`);
            }
          } else {
            delete bigSince.current[t.id];
          }
        }
      }
    };
    const timer = setInterval(() => void tick(), 30_000);
    return () => { unsub(); clearInterval(timer); };
  }, []);
}

/** ✓/✗ test badge for a session (tabs, cards). */
export function TestBadge({ id }: { id: string }) {
  const r = useTests((s) => s.results[id]);
  if (!r) return null;
  if (r.running) return <span className="spinner flex-none" style={{ width: 10, height: 10 }} title="Running tests…" />;
  return (
    <span className={`text-[11px] flex-none ${r.ok ? "text-ok" : "text-danger"}`}
      title={`${r.ok ? "Tests pass" : "Tests fail"} · ${r.cmd} · ${Math.round(r.ms / 1000)}s\n\n${r.tail.split("\n").slice(-12).join("\n")}`}>
      {r.ok ? "✓" : "✗"}
    </span>
  );
}

// ---- the page ----------------------------------------------------------------

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked}
      className={`relative w-9 h-5 rounded-full flex-none cursor-pointer transition-colors ${checked ? "bg-accent" : "bg-raised"}`}
      onClick={() => onChange(!checked)}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function AutoTestConfig() {
  const members = useApp((s) => s.members);
  const cmd = useApp((s) => (typeof s.appSettings.testCommand === "string" ? s.appSettings.testCommand : ""));
  const setAppSetting = useApp((s) => s.setAppSetting);
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    if (!native() || !members[0]) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<string | null>("detect_test_cmd", { repoPath: members[0].repoPath }).then(setDetected).catch(() => setDetected(null)));
  }, [members]);
  return (
    <div className="flex flex-col gap-1.5 text-[12px]">
      <input className="bg-transparent border border-line rounded-lg px-2.5 py-1.5 outline-none focus:border-accent font-mono text-[11.5px]"
        placeholder={detected ? `${detected}  (detected)` : "test command, e.g. npm test"}
        defaultValue={cmd} onBlur={(e) => setAppSetting("testCommand", e.target.value.trim())} />
      <div className="flex gap-2">
        {members.slice(0, 6).map((m) => (
          <button key={m.id} className="composer-btn h-7 text-[11.5px]" onClick={() => void runTestsFor(m.id, true)}>
            <TestBadge id={m.id} /> Run in {titleOf(m.id)}
          </button>
        ))}
      </div>
    </div>
  );
}

function PhoneConfig() {
  const topic = useApp((s) => (typeof s.appSettings.ntfyTopic === "string" ? s.appSettings.ntfyTopic : ""));
  const setAppSetting = useApp((s) => s.setAppSetting);
  const toast = useApp((s) => s.toast);
  useEffect(() => { if (!topic) setAppSetting("ntfyTopic", newTopic()); }, [topic, setAppSetting]);
  const test = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("phone_ping", { topic, title: "Grill Me", body: "Phone pings are working 🔥" })
      .then(() => toast("Sent — check your phone"))
      .catch((e) => toast(`Couldn't send: ${e}`, "warn"));
  };
  return (
    <div className="flex flex-col gap-1.5 text-[12px] text-dim">
      <span>1. Install the free <b>ntfy</b> app on your phone. 2. Subscribe to this private topic:</span>
      <div className="flex gap-2 items-center">
        <code className="md-code select-all">{topic}</code>
        <button className="composer-btn h-7 text-[11.5px]" onClick={() => void navigator.clipboard.writeText(topic).then(() => toast("Topic copied"))}>Copy</button>
        <button className="composer-btn h-7 text-[11.5px]" onClick={() => void test()}>Send test</button>
        <button className="composer-btn h-7 text-[11.5px]" title="Make a new topic (the old one stops getting pings)" onClick={() => setAppSetting("ntfyTopic", newTopic())}>New topic</button>
      </div>
      <span className="text-faint">Pings go through ntfy.sh and only say things like “Rouge: session a needs you” — never code. Keep the topic private.</span>
    </div>
  );
}

function StandupConfig() {
  const at = useApp((s) => (typeof s.appSettings.standupAt === "string" ? s.appSettings.standupAt : "09:00"));
  const setAppSetting = useApp((s) => s.setAppSetting);
  return (
    <label className="flex items-center gap-2 text-[12px] text-dim">
      Time
      <input type="time" className="bg-transparent border border-line rounded-lg px-2 py-1 outline-none" defaultValue={at}
        onBlur={(e) => setAppSetting("standupAt", e.target.value)} />
    </label>
  );
}

function AutoCard({ def }: { def: AutomationDef }) {
  const settings = useApp((s) => s.appSettings);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const enabled = automationOn(settings, def.id);
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-3 transition-colors ${enabled ? "border-line bg-raised/40" : "border-line/60"}`}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-raised flex items-center justify-center flex-none text-dim"><Icon name={def.icon} size={15} /></span>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] text-ink font-medium">{def.title}</div>
          <div className="text-[12.5px] text-dim mt-0.5">{def.desc}</div>
        </div>
        <Switch checked={enabled} onChange={(v) => { const [k, val] = withAutomation(settings, def.id, v); setAppSetting(k, val); }} />
      </div>
      <div className="flex items-center gap-1.5 text-[11.5px] text-faint"><Icon name="clock" size={11} /> {def.trigger}</div>
      {enabled && def.id === "auto-test" ? <AutoTestConfig /> : null}
      {enabled && def.id === "phone-pings" ? <PhoneConfig /> : null}
      {enabled && def.id === "morning-standup" ? <StandupConfig /> : null}
    </div>
  );
}

export function AutomationsPage() {
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("All");
  const list = AUTOMATIONS.filter((a) => cat === "All" || a.category === cat);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[980px] mx-auto px-8 py-8 flex flex-col gap-5">
        <div>
          <h1 className="text-[22px] font-semibold text-ink">Automations</h1>
          <p className="text-[13px] text-dim mt-1">Things Grill Me does for you in the background. Flip one on — it runs while the app is open.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c} className={`px-3.5 h-8 rounded-full text-[12.5px] cursor-pointer transition-colors ${cat === c ? "bg-ink text-bg" : "text-dim hover:text-ink"}`}
              onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((d) => <AutoCard key={d.id} def={d} />)}
        </div>
      </div>
    </div>
  );
}
