/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Task, TaskEvent } from './model';
import { aboutDuration, computeEvidence, evidenceToShow, median } from './overcoming';
import { createTask, initialState } from './reducer';

const NOW = '2026-10-07T12:00:00Z';
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

/** One task per start, so categories come from titles. Each task is captured the day it starts unless told otherwise. */
function history(title: string, starts: { day: number; sec: number }[], createdDay?: number) {
  const tasks: Task[] = [];
  const events: TaskEvent[] = [];
  starts.forEach((s, i) => {
    const id = `${title}-${i}`;
    const created = daysAgo(createdDay ?? s.day);
    tasks.push(createTask(id, title, created, initialState.profile));
    events.push({ id: `c-${id}`, taskId: id, type: 'created', at: created });
    events.push({ id: `s-${id}`, taskId: id, type: 'first_step_done', at: daysAgo(s.day), meta: { latencySec: s.sec } });
  });
  return { tasks, events };
}

const merge = (...hs: ReturnType<typeof history>[]) => ({ tasks: hs.flatMap((h) => h.tasks), events: hs.flatMap((h) => h.events) });
const days = (from: number, n: number, sec: number) => Array.from({ length: n }, (_, i) => ({ day: from + i, sec }));

test('felt durations round the way a person would say them', () => {
  assert.equal(aboutDuration(20), 'under a minute');
  assert.equal(aboutDuration(60 * 40 + 20), 'about 40 minutes');
  assert.equal(aboutDuration(3600 * 5), 'about 5 hours');
  assert.equal(aboutDuration(86_400 * 3), 'about 3 days');
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('nothing to show for a new user: no fabricated praise', () => {
  const h = history('Write the essay', days(1, 3, 60));
  assert.deepEqual(computeEvidence(h.tasks, h.events, NOW), []);
  assert.deepEqual(computeEvidence([], [], NOW), []);
});

test('a real drop in start time becomes evidence, in the guide’s shape', () => {
  const h = history('Write the essay', [...days(20, 10, 40 * 60), ...days(1, 10, 6 * 60)]);
  const ev = computeEvidence(h.tasks, h.events, NOW);
  const writing = ev.find((e) => e.key === 'start_latency_drop:write');
  assert.ok(writing);
  assert.equal(writing.headline, 'It used to take you about 40 minutes to start writing. These last two weeks: about 6 minutes.');
  // All of it was writing, so "to start things" would only repeat the same numbers.
  assert.ok(!ev.some((e) => e.key === 'start_latency_drop:all'));
});

test('the overall line appears when it says something the categories do not', () => {
  const h = merge(
    history('Write the essay', [...days(20, 10, 40 * 60), ...days(1, 10, 6 * 60)]),
    history('Clean the kitchen', [...days(25, 10, 20 * 60), ...days(2, 10, 10 * 60)]),
  );
  const keys = computeEvidence(h.tasks, h.events, NOW).map((e) => e.key);
  assert.ok(keys.includes('start_latency_drop:all'));
  assert.equal(keys[0], 'start_latency_drop:write');
});

test('too few samples on either side means silence', () => {
  const h = history('Write the essay', [...days(20, 7, 40 * 60), ...days(1, 10, 6 * 60)]);
  assert.deepEqual(computeEvidence(h.tasks, h.events, NOW), []);
});

test('small or noisy changes are not celebrated', () => {
  // 20% faster: below the 25% bar.
  const a = history('Write the essay', [...days(20, 10, 600), ...days(1, 10, 480)]);
  assert.deepEqual(computeEvidence(a.tasks, a.events, NOW), []);
  // 50% faster but only 30 seconds: not a change anyone would feel.
  const b = history('Write the essay', [...days(20, 10, 60), ...days(1, 10, 30)]);
  assert.deepEqual(computeEvidence(b.tasks, b.events, NOW), []);
});

test('a category that was stuck and now moves is "unlocked"', () => {
  const stuck = history('Pay the insurance bill', [], 100);
  // Two admin tasks sat there all along, never started.
  stuck.tasks.push(createTask('w1', 'Do taxes', daysAgo(70), initialState.profile), createTask('w2', 'Renew passport', daysAgo(70), initialState.profile));
  stuck.events.push({ id: 'old', taskId: 'w1', type: 'created', at: daysAgo(70) });
  const recent = history('Pay the bills', days(2, 3, 300), 40);
  const h = merge(stuck, recent);
  const ev = computeEvidence(h.tasks, h.events, NOW);
  const admin = ev.find((e) => e.key === 'category_unlocked:admin');
  assert.ok(admin);
  assert.equal(admin.headline, 'You started 3 admin tasks in the last month. The month before: none.');
});

test('"none before" needs history: a three-week-old account gets nothing', () => {
  const h = history('Pay the bills', days(2, 4, 300), 20);
  assert.equal(computeEvidence(h.tasks, h.events, NOW).filter((e) => e.kind === 'category_unlocked').length, 0);
});

test('one card buys a few quiet days, even when there is more to say', () => {
  const h = merge(
    history('Write the essay', [...days(20, 10, 40 * 60), ...days(1, 10, 6 * 60)]),
    history('Clean the kitchen', [...days(25, 10, 20 * 60), ...days(2, 10, 10 * 60)]),
  );
  const ev = computeEvidence(h.tasks, h.events, NOW);
  assert.ok(ev.length >= 2);
  assert.equal(evidenceToShow(ev, { [ev[0].key]: daysAgo(1) }, NOW), undefined);
  assert.equal(evidenceToShow(ev, { [ev[0].key]: daysAgo(4) }, NOW)?.key, ev[1].key);
});

test('the Now screen shows each piece of evidence at most once a fortnight', () => {
  const h = history('Write the essay', [...days(20, 10, 40 * 60), ...days(1, 10, 6 * 60)]);
  const ev = computeEvidence(h.tasks, h.events, NOW);
  const first = evidenceToShow(ev, {}, NOW)!;
  const shown = Object.fromEntries(ev.map((e) => [e.key, daysAgo(3)]));
  assert.equal(evidenceToShow(ev, shown, NOW), undefined);
  assert.equal(evidenceToShow(ev, { ...shown, [first.key]: daysAgo(15) }, NOW)?.key, first.key);
});

test('a drop that only appeared in the last few days is not shown yet', () => {
  // Baseline slow, and only the last two days are fast: a lucky stretch, not a change.
  const lucky = Array.from({ length: 8 }, (_, i) => ({ day: i * 0.25, sec: 6 * 60 }));
  const h = history('Write the essay', [...days(20, 10, 40 * 60), ...days(3, 8, 40 * 60), ...lucky]);
  assert.ok(!computeEvidence(h.tasks, h.events, NOW).some((e) => e.kind === 'start_latency_drop'));
  // Three days on, the same drop has held, so then it is shown.
  assert.ok(computeEvidence(h.tasks, h.events, daysAgo(-3)).some((e) => e.kind === 'start_latency_drop'));
});

test('a faster median is not celebrated when more tasks were dropped unstarted lately', () => {
  const h = history('Write the essay', [...days(20, 10, 40 * 60), ...days(1, 10, 6 * 60)]);
  // Five writing tasks were shown and let go without a start in the last two weeks; none before.
  for (let i = 0; i < 5; i++) {
    const id = `dropped-${i}`;
    h.tasks.push(createTask(id, 'Write the essay', daysAgo(5), initialState.profile));
    h.events.push({ id: `o-${id}`, taskId: id, type: 'opened', at: daysAgo(5) });
    h.events.push({ id: `r-${id}`, taskId: id, type: 'released', at: daysAgo(4) });
  }
  h.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  assert.ok(!computeEvidence(h.tasks, h.events, NOW).some((e) => e.key === 'start_latency_drop:write'));
});
