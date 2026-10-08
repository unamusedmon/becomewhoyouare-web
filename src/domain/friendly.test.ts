/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickNow } from './planner';
import { initialState, reducer, type Action, type AppState } from './reducer';
import { isFresh, track, UNDO_MS, type UndoSlot } from './undo';

const t0 = Date.parse('2026-10-07T09:00:00Z');
const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();

const onboarded = reducer(initialState, { type: 'complete_onboarding', at: at(-1) });

function withTasks(...titles: string[]): AppState {
  return titles.reduce<AppState>((s, title, i) => reducer(s, { type: 'capture', at: at(i), id: `t${i}`, title }), onboarded);
}

/** Runs actions through the reducer the way the app does, keeping the undo slot. */
function play(s: AppState, actions: Action[], slot?: UndoSlot): { s: AppState; slot?: UndoSlot } {
  for (const a of actions) {
    const next = reducer(s, a);
    slot = track(slot, a, s, next);
    s = next;
  }
  return { s, slot };
}

test('an accidental "done" can be undone, and the task comes back as it was', () => {
  const start = withTasks('Call the dentist');
  const { s, slot } = play(start, [{ type: 'complete', at: at(10), taskId: 't0' }]);
  assert.equal(s.tasks[0].state, 'done');
  assert.equal(slot?.label, 'Marked done.');
  assert.equal(slot?.before, start);
  assert.equal(pickNow(slot!.before).task?.id, 't0');
});

test('background ticks keep the undo; anything new the person does replaces it', () => {
  const start = withTasks('Call the dentist', 'Do taxes');
  let r = play(start, [{ type: 'release', at: at(10), taskId: 't0' }, { type: 'tick', at: at(11) }]);
  assert.equal(r.slot?.label, 'Let go.');
  r = play(r.s, [{ type: 'capture', at: at(12), id: 'new', title: 'Buy milk' }], r.slot);
  assert.equal(r.slot, undefined, 'undoing now would erase the new capture, so the slot is gone');
});

test('onboarding choices are not offered for undo one at a time', () => {
  const s = reducer(initialState, { type: 'capture', at: at(0), id: 't0', title: 'Do taxes' });
  assert.equal(play(s, [{ type: 'rest', at: at(1), taskId: 't0' }]).slot, undefined);
});

test('the undo window closes', () => {
  const { slot } = play(withTasks('Do taxes'), [{ type: 'not_now', at: at(10), taskId: 't0' }]);
  assert.ok(isFresh(slot, t0 + 10_000 + UNDO_MS - 1));
  assert.ok(!isFresh(slot, t0 + 10_000 + UNDO_MS));
});

test('onboarding "not now" and "let it go" can both be brought back', () => {
  let s = withTasks('Do taxes', 'Call mom');
  s = reducer(s, { type: 'rest', at: at(5), taskId: 't0' });
  s = reducer(s, { type: 'release', at: at(6), taskId: 't1' });
  assert.equal(pickNow(s).task, undefined);
  s = reducer(s, { type: 'restore', at: at(7), taskId: 't0' });
  s = reducer(s, { type: 'restore', at: at(8), taskId: 't1' });
  assert.deepEqual(s.tasks.map((t) => t.state), ['open', 'open']);
  assert.equal(s.events.at(-1)?.type, 'restored');
  // Restoring something that isn't away does nothing.
  assert.equal(reducer(s, { type: 'restore', at: at(9), taskId: 't0' }), s);
});

test('renaming fixes a misheard title and gives it a matching first step', () => {
  let s = withTasks('fix the commuter');
  s = reducer(s, { type: 'rename', at: at(5), taskId: 't0', title: '  Fix the  computer ' });
  assert.equal(s.tasks[0].title, 'Fix the computer');
  assert.match(s.tasks[0].firstStep.text, /computer/);
  assert.equal(reducer(s, { type: 'rename', at: at(6), taskId: 't0', title: '   ' }), s, 'blank names are ignored');
});

test('renaming keeps a first step the person wrote themselves', () => {
  let s = withTasks('Do taxes');
  s = reducer(s, { type: 'edit_step', at: at(5), taskId: 't0', text: 'Find last year’s return' });
  s = reducer(s, { type: 'rename', at: at(6), taskId: 't0', title: 'Do 2026 taxes' });
  assert.equal(s.tasks[0].firstStep.text, 'Find last year’s return');
});
