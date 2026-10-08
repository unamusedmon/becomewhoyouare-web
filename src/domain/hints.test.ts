/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HINT_GAP_MS, initialHints, markSeen, pickHint } from './hints';
import { initialState, migrate, reducer } from './reducer';

const t0 = Date.parse('2026-10-08T09:00:00Z');
const iso = (ms: number) => new Date(t0 + ms).toISOString();

test('one hint at a time, in priority order, only from what the screen offers', () => {
  assert.equal(pickHint(initialHints, ['also_here', 'mic', 'energy'], t0), 'energy');
  assert.equal(pickHint(initialHints, ['also_here'], t0), 'also_here');
  assert.equal(pickHint(initialHints, [], t0), undefined);
});

test('a seen hint never comes back, and the next one waits a breath', () => {
  const h = markSeen(initialHints, 'energy', iso(0));
  assert.equal(pickHint(h, ['energy', 'mic'], t0 + 1000), undefined, 'too soon after the last one');
  assert.equal(pickHint(h, ['energy', 'mic'], t0 + HINT_GAP_MS), 'mic');
});

test('a hint on screen stays put until dismissed, even if another becomes eligible', () => {
  assert.equal(pickHint(initialHints, ['energy', 'also_here'], t0, 'also_here'), 'also_here');
  // ...but leaves when its feature leaves the screen.
  assert.equal(pickHint(initialHints, ['energy'], t0, 'also_here'), 'energy');
});

test('hints switched off show nothing; "show them again" brings them all back', () => {
  let s = reducer(initialState, { type: 'set_hints', at: iso(0), enabled: false });
  assert.equal(pickHint(s.hints, ['energy'], t0 + HINT_GAP_MS), undefined);
  s = reducer(s, { type: 'hint_seen', at: iso(1), id: 'mic' });
  s = reducer(s, { type: 'reset_hints', at: iso(2) });
  assert.deepEqual(s.hints, { enabled: true, seen: {} });
});

test('using a feature retires its hint without it ever showing', () => {
  let s = reducer(initialState, { type: 'set_energy', at: iso(0), level: 'low' });
  assert.ok(s.hints.seen.energy);
  s = reducer(s, { type: 'capture', at: iso(1), id: 't0', title: 'Call mom', via: 'voice' });
  assert.ok(s.hints.seen.mic);
  s = reducer(s, { type: 'capture', at: iso(2), id: 't1', title: 'Do taxes' });
  assert.equal(s.hints.seen.also_here, undefined, 'typing is not using the list');
  s = reducer(s, { type: 'pin_now', at: iso(3), taskId: 't1' });
  assert.ok(s.hints.seen.also_here);
});

test('saves from before hints existed load with hints on', () => {
  const { hints: _drop, ...old } = initialState;
  assert.deepEqual(migrate(old as typeof initialState).hints, { enabled: true, seen: {} });
});
