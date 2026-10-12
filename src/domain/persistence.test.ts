/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { initialState, readSaved } from './reducer';
import { isFromNewerApp, mergeStates, parseRemote, toRemote } from './sync';

// A sync file written by version 1 of the app, checked in. The phone and the web
// both carry this fixture, so if either one stops reading what the other writes,
// this test says so before a real sync does.
const fixture = readFileSync(new URL('./fixtures/sync-v1.json', import.meta.url), 'utf8');

test('a version 1 sync file still parses and merges into a fresh device', () => {
  const file = parseRemote(fixture);
  assert.ok(file, 'the checked-in v1 sync file no longer parses');
  const merged = mergeStates(initialState, file.state);
  assert.deepEqual(merged.tasks.map((t) => t.id).sort(), file.state.tasks.map((t) => t.id).sort());
  assert.deepEqual(merged.routines.map((r) => r.id), ['r1']);
  assert.deepEqual(merged.becomings.map((b) => b.id), ['b1']);
  assert.equal(merged.events.length, file.state.events.length);
  assert.equal(merged.tasks.find((t) => t.id === 't1')?.state, 'done');
  assert.equal(merged.energy, 'medium');
  assert.ok(merged.onboarding.completedAt);
});

test('what this version writes, this version reads back unchanged', () => {
  const file = parseRemote(fixture)!;
  const merged = mergeStates(initialState, file.state);
  const again = parseRemote(JSON.stringify(toRemote(merged, file.writtenAt)))!;
  assert.deepEqual(again.state.tasks, merged.tasks);
  assert.deepEqual(again.state.events, merged.events);
});

test('a sync file from a newer app is recognized as such, not as garbage', () => {
  const newer = JSON.stringify({ ...JSON.parse(fixture), version: 2 });
  assert.equal(parseRemote(newer), undefined);
  assert.equal(isFromNewerApp(newer), true);
  assert.equal(isFromNewerApp(fixture), false);
  assert.equal(isFromNewerApp('not json'), false);
  assert.equal(isFromNewerApp('{"version":2}'), false);
});

test('nothing saved yet is a fresh start, not an unreadable save', () => {
  assert.deepEqual(readSaved(null), { state: null, unreadable: false });
  assert.deepEqual(readSaved(''), { state: null, unreadable: false });
});

test('a readable save comes back migrated', () => {
  const { state, unreadable } = readSaved(JSON.stringify({ version: 1, tasks: [], events: [] }));
  assert.equal(unreadable, false);
  assert.ok(state);
  assert.deepEqual(state.hints, initialState.hints);
  assert.deepEqual(state.nudges, initialState.nudges);
});

test('a corrupted or newer save is flagged so it can be kept, never silently replaced', () => {
  for (const json of ['{"version":1,"tasks":[', 'null', '"hello"', JSON.stringify({ ...initialState, version: 2 })]) {
    assert.deepEqual(readSaved(json), { state: null, unreadable: true }, json);
  }
});
