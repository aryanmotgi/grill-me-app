/* Run: node docs/deck-kit/submission.test.cjs
 * Plain node so the kit stays runnable without the app's toolchain. */
const { execFileSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const gen = path.join(__dirname, 'submission.cjs');
const root = path.join(__dirname, '..', '..');
const run = (pitch) => execFileSync('node', [gen, path.join(root, pitch)], { encoding: 'utf8' });

let pass = 0;
const it = (what, fn) => { fn(); console.log('  ok  ' + what); pass++; };

it('fills what the pitch answers', () => {
  const out = run('docs/PITCH.dealghost.md');
  assert.match(out, /# DealGhost — submission/);
  assert.match(out, /A memory for why deals die/);
  assert.match(out, /\*\*Listen\*\* — Reads the calls you already record/);
});

it('never prints a pitch placeholder as if it were an answer', () => {
  // the whole failure mode: a submission containing "[ action ]" read by a judge
  for (const p of ['docs/PITCH.template.md', 'docs/PITCH.dealghost.md']) {
    const out = run(p);
    assert.ok(!/\[ [a-z]/.test(out), `bracket placeholder leaked from ${p}`);
    assert.ok(!out.includes('—]'), `em-dash placeholder leaked from ${p}`);
  }
});

it('asks rather than invents when the pitch is empty', () => {
  const out = run('docs/PITCH.template.md');
  assert.match(out, /_Fill section 5 of the pitch/);
  assert.match(out, /_Why did you build this\?/);
  assert.match(out, /_Fill section 14 of the pitch/);
});

it('never generates the sections only a person can answer', () => {
  // a generated war story is the easiest thing for a judge to puncture
  const out = run('docs/PITCH.dealghost.md');
  for (const h of ['Challenges we ran into', 'What we learned', 'How we built it']) {
    const body = out.split(`## ${h}`)[1].split('\n##')[0];
    assert.match(body, /_Write this yourself/, `${h} should stay a prompt`);
  }
});

it('always ends with the deadline checklist', () => {
  for (const p of ['docs/PITCH.template.md', 'docs/PITCH.dealghost.md']) {
    const out = run(p);
    assert.match(out, /## Before the deadline/);
    assert.match(out, /- \[ \] Repo public/);
    assert.match(out, /- \[ \] Submitted, with time to spare/);
  }
});

it('says where it came from, so nobody hand-edits the generated half', () => {
  assert.match(run('docs/PITCH.dealghost.md'), /Generated from PITCH\.dealghost\.md by submission\.cjs/);
});

console.log(`\n${pass} passed`);
