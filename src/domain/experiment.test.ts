/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { armFor, firstStepTestResult, MIN_PER_ARM } from './experiment';
import { initialState, reducer, type AppState } from './reducer';

const t0 = '2026-10-08T09:00:00Z';
const plus = (sec: number) => new Date(Date.parse(t0) + sec * 1000).toISOString();

test('off by default: captured tasks get a first step and no arm', () => {
  const s = reducer(initialState, { type: 'capture', at: t0, id: 'a1', title: 'Write the essay' });
  assert.notEqual(s.tasks[0].firstStep.source, 'holdout');
  assert.equal(s.events[0].meta, undefined);
});

test('when on, tasks split by id into the two arms, and the without arm shows only the task', () => {
  let s: AppState = reducer(initialState, { type: 'set_first_step_test', at: t0, enabled: true });
  const ids = Array.from({ length: 40 }, (_, i) => `task${i}`);
  for (const id of ids) s = reducer(s, { type: 'capture', at: t0, id, title: 'Write the essay' });
  const without = s.tasks.filter((t) => t.firstStep.source === 'holdout');
  assert.ok(without.length > 5 && without.length < 35, 'roughly half');
  for (const t of without) {
    assert.equal(armFor(t.id), 'without_step');
    assert.equal(t.firstStep.text, 'Write the essay');
  }
  assert.ok(s.events.every((e) => e.meta?.arm === armFor(e.taskId)));
});

test('no result until both arms have enough starts, then medians by arm', () => {
  let s: AppState = reducer(initialState, { type: 'set_first_step_test', at: t0, enabled: true });
  const ids = Array.from({ length: 120 }, (_, i) => `t${i}`);
  const counts = { with_step: 0, without_step: 0 };
  let clock = 0;
  for (const id of ids) {
    const arm = armFor(id);
    if (counts[arm] >= MIN_PER_ARM) continue;
    counts[arm]++;
    s = reducer(s, { type: 'capture', at: plus(clock), id, title: 'Write the essay' });
    s = reducer(s, { type: 'open', at: plus(clock + 1), taskId: id });
    s = reducer(s, { type: 'first_step_done', at: plus(clock + 1 + (arm === 'with_step' ? 60 : 600)), taskId: id });
    clock += 1000;
    if (counts.with_step + counts.without_step === 2 * MIN_PER_ARM - 1) assert.equal(firstStepTestResult(s.events, s.tasks), undefined);
  }
  const r = firstStepTestResult(s.events, s.tasks);
  assert.ok(r);
  assert.deepEqual([r.withStep.n, r.withStep.medianSec], [MIN_PER_ARM, 60]);
  assert.deepEqual([r.withoutStep.n, r.withoutStep.medianSec], [MIN_PER_ARM, 600]);
});
