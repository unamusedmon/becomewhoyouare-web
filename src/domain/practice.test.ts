/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { missingPractices, PRACTICES } from './practice';
import { initialState, reducer, type AppState } from './reducer';
import { mergeStates, toRemote } from './sync';

const t0 = '2026-10-12T08:00:00Z';
const addPack = (s: AppState, at = t0) =>
  missingPractices(s).reduce((acc, p) => reducer(acc, { type: 'add_routine', id: p.id, title: p.title, cadence: p.cadence, at }), s);

test('nobody gets the practice unless they add it', () => {
  assert.equal(initialState.routines.length, 0);
  assert.equal(missingPractices(initialState).length, PRACTICES.length);
});

test('adding the pack creates each practice once, and today\'s daily ones show up', () => {
  const s = addPack(initialState);
  assert.deepEqual(s.routines.map((r) => r.id), PRACTICES.map((p) => p.id));
  assert.equal(missingPractices(s).length, 0);
  assert.ok(s.tasks.some((t) => t.routineId === 'practice-demon'));
  assert.deepEqual(addPack(s), s, 'adding it again changes nothing');
});

test('adding it on two devices still gives one set after sync', () => {
  const phone = addPack(initialState, t0);
  const laptop = addPack(initialState, '2026-10-12T08:05:00Z');
  const merged = mergeStates(phone, toRemote(laptop, '2026-10-12T08:06:00Z').state);
  assert.equal(merged.routines.length, PRACTICES.length);
});

test('a practice that was let go is not added back', () => {
  const s = addPack(initialState);
  const released = { ...s, routines: s.routines.map((r) => (r.id === 'practice-walk' ? { ...r, status: 'released' as const } : r)) };
  assert.equal(missingPractices(released).length, 0);
});
