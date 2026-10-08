/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { editsSince, orgEdits, orgStamp, parseOrg, renderOrg } from './org';
import { initialState, reducer, type Action, type AppState } from './reducer';
import { mergeStates, parseRemote, toRemote } from './sync';

const t0 = '2026-10-08T09:00:00Z';
const plus = (min: number) => new Date(Date.parse(t0) + min * 60_000).toISOString();
type NoAt<A> = A extends unknown ? Omit<A, 'at'> : never;
const run = (s: AppState, at: string, ...actions: NoAt<Action>[]) =>
  actions.reduce((acc, a) => reducer(acc, { ...a, at } as Action), s);

function phoneAndLaptop() {
  const shared = run(initialState, t0, { type: 'capture', id: 'a', title: 'Email the landlord' }, { type: 'complete_onboarding' });
  return { phone: shared, laptop: mergeStates(initialState, toRemote(shared, t0).state) };
}

test('the remote file round-trips and leaves device-only settings behind', () => {
  const s = run(initialState, t0, { type: 'set_nudges', patch: { enabled: true } }, { type: 'capture', id: 'a', title: 'Taxes' });
  const file = parseRemote(JSON.stringify(toRemote(s, t0)));
  assert.ok(file);
  assert.equal(file.state.tasks.length, 1);
  assert.equal('nudges' in file.state, false);
  assert.equal(parseRemote('{"nope":1}'), undefined);
  assert.equal(parseRemote('not json'), undefined);
});

test('work done on both devices ends up on both, whichever merges first', () => {
  let { phone, laptop } = phoneAndLaptop();
  phone = run(phone, plus(5), { type: 'capture', id: 'p', title: 'Call mom' });
  laptop = run(laptop, plus(6), { type: 'capture', id: 'l', title: 'Write the essay' }, { type: 'complete', taskId: 'a' });
  const onPhone = mergeStates(phone, toRemote(laptop, plus(7)).state);
  const onLaptop = mergeStates(laptop, toRemote(phone, plus(7)).state);
  for (const s of [onPhone, onLaptop]) {
    assert.deepEqual(s.tasks.map((t) => t.id).sort(), ['a', 'l', 'p']);
    assert.equal(s.tasks.find((t) => t.id === 'a')!.state, 'done');
  }
  assert.deepEqual(onPhone.events.map((e) => e.id).sort(), onLaptop.events.map((e) => e.id).sort());
});

test('the most recent edit to the same task wins', () => {
  let { phone, laptop } = phoneAndLaptop();
  phone = run(phone, plus(5), { type: 'rename', taskId: 'a', title: 'Email the landlord about the leak' });
  laptop = run(laptop, plus(9), { type: 'release', taskId: 'a' });
  const merged = mergeStates(phone, toRemote(laptop, plus(10)).state);
  assert.equal(merged.tasks[0].state, 'released');
  // Merging again changes nothing.
  assert.deepEqual(mergeStates(merged, toRemote(laptop, plus(10)).state).tasks, merged.tasks);
});

test('settings follow whichever device changed last; notifications stay on the phone', () => {
  let { phone, laptop } = phoneAndLaptop();
  phone = run(phone, plus(1), { type: 'set_nudges', patch: { enabled: true } }, { type: 'set_energy', level: 'high' });
  laptop = run(laptop, plus(3), { type: 'set_energy', level: 'low' });
  const merged = mergeStates(phone, toRemote(laptop, plus(4)).state);
  assert.equal(merged.energy, 'low');
  assert.equal(merged.nudges.enabled, true);
});

test('both devices spawning the same routine day collapse into one task and one "created"', () => {
  const base = run(initialState, t0, { type: 'add_routine', id: 'r', title: 'Morning pages', cadence: 'daily' });
  const phone = run(base, plus(60 * 24), { type: 'complete', taskId: base.tasks[0].id }, { type: 'tick' });
  const laptop = run(base, plus(60 * 24 + 1), { type: 'complete', taskId: base.tasks[0].id }, { type: 'tick' });
  const merged = mergeStates(phone, toRemote(laptop, plus(60 * 25)).state);
  const ids = merged.tasks.map((t) => t.id);
  assert.equal(ids.length, new Set(ids).size);
  const created = merged.events.filter((e) => e.type === 'created').map((e) => e.taskId);
  assert.equal(created.length, new Set(created).size);
});

test('the org file has every live thing, under its section, with ids', () => {
  const s = run(initialState, t0,
    { type: 'add_becoming', id: 'b', statement: 'someone who writes every week' },
    { type: 'capture', id: 'a', title: 'Email the landlord' },
    { type: 'capture', id: 'z', title: 'Old thing' },
    { type: 'release', taskId: 'z' },
    { type: 'add_routine', id: 'r', title: 'Morning pages', cadence: 'daily' });
  const org = renderOrg(s, t0);
  const items = parseOrg(org);
  assert.deepEqual(items.map((i) => [i.section, i.keyword ?? '', i.title]), [
    ['Becoming', '', 'someone who writes every week'],
    ['Tasks', 'TODO', 'Email the landlord'],
    ['Tasks', 'TODO', 'Morning pages'],
    ['Routines', '', 'Morning pages'],
    ['Set aside', 'CANCELLED', 'Old thing'],
  ]);
  assert.equal(items[1].props.ID, 'a');
  assert.ok(items[1].props.FIRST_STEP);
  // Out of the window, let-go tasks drop out of the file (they're still in the app).
  assert.ok(!parseOrg(renderOrg(s, plus(60 * 24 * 30))).some((i) => i.title === 'Old thing'));
});

test('edits made in org come back as app actions', () => {
  const s = run(initialState, t0,
    { type: 'add_becoming', id: 'b', statement: 'someone who writes' },
    { type: 'capture', id: 'a', title: 'Email the landlord' },
    { type: 'capture', id: 'c', title: 'Call mom' });
  const base = renderOrg(s, t0);
  const edited = base
    .replace('** TODO Email the landlord', '** DONE Email the landlord')
    .replace('** TODO Call mom', '** TODO Call mom about Sunday :family:')
    .replace('** someone who writes', '** someone who writes every week')
    .replace('* Routines', '** TODO Buy stamps\n* Routines\n** Stretch\n   :PROPERTIES:\n   :CADENCE: daily\n   :END:');
  let n = 0;
  const actions = orgEdits(base, edited, s, () => `new${++n}`);
  assert.deepEqual(actions, [
    { type: 'edit_becoming', id: 'b', statement: 'someone who writes every week' },
    { type: 'complete', taskId: 'a' },
    { type: 'rename', taskId: 'c', title: 'Call mom about Sunday' },
    { type: 'capture', id: 'new1', title: 'Buy stamps' },
    { type: 'add_routine', id: 'new2', title: 'Stretch', cadence: 'daily' },
  ]);
});

test('an untouched or stale org file changes nothing', () => {
  let s = run(initialState, t0, { type: 'capture', id: 'a', title: 'Email the landlord' });
  const base = renderOrg(s, t0);
  assert.deepEqual(orgEdits(base, base, s, () => 'x'), []);
  // The app finished it after the file was written; the file still says TODO. No undo.
  s = run(s, plus(5), { type: 'complete', taskId: 'a' });
  const edited = base.replace('#+STARTUP: overview', '#+STARTUP: content');
  assert.deepEqual(orgEdits(base, edited, s, () => 'x'), []);
  // And marking it DONE in org when the app already did is not repeated.
  assert.deepEqual(orgEdits(base, base.replace('TODO Email', 'DONE Email'), s, () => 'x'), []);
});

test('an org file from an older sync is ignored, so turning org back on never reverts work', () => {
  const s1 = run(initialState, t0, { type: 'capture', id: 'a', title: 'Email the landlord' }, { type: 'release', taskId: 'a' });
  const old = renderOrg(s1, t0);
  assert.equal(orgStamp(old), t0);
  // Later the task came back and was renamed, through a sync that didn't write the org file.
  const s2 = run(s1, plus(60), { type: 'restore', taskId: 'a' }, { type: 'rename', taskId: 'a', title: 'Email the landlord about the boiler' });
  const remote = { state: s2, writtenAt: plus(61) };
  assert.deepEqual(editsSince(old, remote, s2, () => 'x'), []);
  // The current file, edited, still works.
  const current = renderOrg(s2, remote.writtenAt);
  assert.deepEqual(editsSince(current.replace('** TODO Email', '** DONE Email'), remote, s2, () => 'x'), [{ type: 'complete', taskId: 'a' }]);
});
