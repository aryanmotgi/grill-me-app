#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Keeps CHANGELOG.md honest.
//
//   node scripts/changelog.cjs check            every merged PR has an entry?
//   node scripts/changelog.cjs skeleton 243      a block to fill in
//
// PR numbers come from the "(#N)" that squash-merges leave in commit subjects,
// so the list of what needs an entry is taken from git rather than remembered.
// ---------------------------------------------------------------------------

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "CHANGELOG.md");

/** Merged PRs, newest first, as [number, subject] — from squash-merge subjects. */
function mergedPrs(ref) {
  const log = execSync(`git log --format=%s ${ref}`, { cwd: ROOT, encoding: "utf8" });
  const seen = new Set();
  const out = [];
  for (const line of log.trim().split("\n")) {
    const m = line.match(/^(.*)\s\(#(\d+)\)$/);
    if (!m || seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push([m[2], m[1]]);
  }
  return out;
}

/** PR numbers CHANGELOG.md mentions, as a heading or in the Earlier index. */
function documented() {
  if (!fs.existsSync(FILE)) return new Set();
  const text = fs.readFileSync(FILE, "utf8");
  return new Set([...text.matchAll(/^(?:##\s*|-\s*)#(\d+)\b/gm)].map((m) => m[1]));
}

function skeleton(n, subject) {
  const tag = (subject ?? "").match(/^([a-z]+\([a-z-]+\)|[a-z]+)[:!]/)?.[1];
  const title = (subject ?? "<what it does, in a few words>").replace(/^[^:]*:\s*/, "");
  const today = new Date().toISOString().slice(0, 10);
  return [
    `## #${n} — ${title}`,
    "",
    `${tag ? "`" + tag + "` · " : ""}merged ${today}`,
    "",
    "**Added**",
    "- ",
    "",
    "**Fixed**",
    "- ",
    "",
  ].join("\n");
}

const [cmd, arg] = process.argv.slice(2);

if (cmd === "skeleton") {
  if (!arg) {
    console.error("usage: changelog.cjs skeleton <pr-number>");
    process.exit(2);
  }
  const subject = mergedPrs("HEAD").find(([n]) => n === String(arg))?.[1];
  process.stdout.write(skeleton(arg, subject));
  process.exit(0);
}

if (cmd === "check" || cmd === undefined) {
  // default to the remote so a local branch mid-work doesn't read as missing
  let ref = "origin/main";
  try {
    execSync(`git rev-parse --verify --quiet ${ref}`, { cwd: ROOT, stdio: "ignore" });
  } catch {
    ref = "HEAD";
  }
  const have = documented();
  const missing = mergedPrs(ref).filter(([n]) => !have.has(n));
  if (missing.length === 0) {
    console.log(`CHANGELOG.md covers every merged PR on ${ref}.`);
    process.exit(0);
  }
  console.error(`${missing.length} merged PR(s) have no CHANGELOG.md entry:\n`);
  for (const [n, s] of missing) console.error(`  #${n}  ${s}`);
  console.error(`\nPaste a block for the newest with:\n  node scripts/changelog.cjs skeleton ${missing[0][0]}`);
  process.exit(1);
}

console.error(`unknown command ${cmd}`);
process.exit(2);
