/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Action } from './actions';
import { isTaskAction } from './tasks';
import { isRoutineAction } from './routines';
import { isIntentionAction } from './intentions';
import { isBecomingAction } from './becomings';
import { isSettingsAction } from './settings';
import { initialState, reducer } from './reducer';

type Owner = 'tasks' | 'routines' | 'intentions' | 'becomings' | 'settings' | 'sync';

/**
 * A deliberately independent routing contract: every Action variant must be
 * classified in this table, even when the predicates and slices change.
 */
const expectedOwners = {
  capture: 'tasks',
  open: 'tasks',
  backgrounded: 'tasks',
  first_step_done: 'tasks',
  complete: 'tasks',
  not_now: 'tasks',
  pause: 'tasks',
  shrink: 'tasks',
  next_alternative: 'tasks',
  edit_step: 'tasks',
  release: 'tasks',
  keep_anyway: 'tasks',
  pin_now: 'tasks',
  set_energy: 'tasks',
  rest: 'tasks',
  restore: 'tasks',
  rename: 'tasks',
  restore_routine: 'routines',
  add_routine: 'routines',
  tick: 'routines',
  set_recurrence_enabled: 'routines',
  start_recurrence_session: 'routines',
  dismiss_recurrence_session: 'routines',
  set_recurrence_frequency: 'routines',
  answer_recurrence: 'routines',
  follow_up_recurrence: 'routines',
  reshape_routine: 'routines',
  link_routine_becoming: 'routines',
  set_intention: 'intentions',
  clear_intention: 'intentions',
  fire_intention: 'intentions',
  add_becoming: 'becomings',
  edit_becoming: 'becomings',
  outgrow_becoming: 'becomings',
  link_task_becoming: 'becomings',
  complete_onboarding: 'settings',
  evidence_shown: 'settings',
  set_nudges: 'settings',
  hint_seen: 'settings',
  set_hints: 'settings',
  reset_hints: 'settings',
  set_first_step_test: 'settings',
  sync_merge: 'sync',
} as const satisfies Record<Action['type'], Owner>;

const t0 = '2026-10-08T09:00:00.000Z';
const later = (minutes: number) => new Date(Date.parse(t0) + minutes * 60_000).toISOString();

test('every action belongs to exactly one runtime slice, except sync_merge', () => {
  for (const [type, expected] of Object.entries(expectedOwners)) {
    // The guards inspect only the discriminant; no action payload is needed.
    const action = { type, at: t0 } as Action;
    const actual = [
      isTaskAction(action) && 'tasks',
      isRoutineAction(action) && 'routines',
      isIntentionAction(action) && 'intentions',
      isBecomingAction(action) && 'becomings',
      isSettingsAction(action) && 'settings',
    ].filter(Boolean);
    assert.deepEqual(actual, expected === 'sync' ? [] : [expected], type);
  }
});

test('task, becoming, routine, and settings actions keep their behavior', () => {
  let state = reducer(initialState, { type: 'capture', at: t0, id: 't', title: 'Write a page' });
  assert.equal(state.tasks[0].title, 'Write a page');
  assert.equal(state.events[0].type, 'created');

  state = reducer(state, { type: 'add_becoming', at: later(1), id: 'b', statement: 'a writer' });
  state = reducer(state, { type: 'link_task_becoming', at: later(2), taskId: 't', becomingId: 'b' });
  assert.deepEqual(state.tasks[0].becomingIds, ['b']);

  state = reducer(state, { type: 'add_routine', at: later(3), id: 'r', title: 'Morning pages', cadence: 'daily' });
  assert.equal(state.routines.length, 1);
  assert.equal(state.tasks.filter((task) => task.routineId === 'r').length, 1);
  const beforeRepeat = state;
  state = reducer(state, { type: 'tick', at: later(4) });
  assert.equal(state, beforeRepeat, 'repeated tick is a no-op');

  state = reducer(state, { type: 'set_hints', at: later(5), enabled: false });
  assert.equal(state.hints.enabled, false);
  assert.equal(state.changedAt, later(5));
});

test('a time intention fires once, when tick reaches its cue', () => {
  let state = reducer(initialState, { type: 'capture', at: t0, id: 't', title: 'Call home' });
  state = reducer(state, {
    type: 'set_intention', at: later(1), taskId: 't',
    trigger: { kind: 'time', at: later(10) },
  });
  assert.equal(state.tasks[0].intention?.firedAt, undefined);
  state = reducer(state, { type: 'tick', at: later(9) });
  assert.equal(state.tasks[0].intention?.firedAt, undefined);
  state = reducer(state, { type: 'tick', at: later(10) });
  assert.equal(state.tasks[0].intention?.firedAt, later(10));
  const fired = state.events.filter((event) => event.type === 'intention_fired');
  assert.equal(fired.length, 1);
  const once = state;
  state = reducer(state, { type: 'tick', at: later(11) });
  assert.equal(state, once);
});

test('sync_merge bypasses slices and merges another device state', () => {
  const remote = reducer(initialState, { type: 'capture', at: t0, id: 'remote', title: 'Read' });
  const merged = reducer(initialState, { type: 'sync_merge', at: later(1), remote });
  assert.deepEqual(merged.tasks.map((task) => task.id), ['remote']);
});
