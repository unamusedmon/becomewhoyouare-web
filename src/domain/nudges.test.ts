/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cueText, parseClock, settleIntention, timePresets } from './intention';
import { BODY_MAX, planNudges, TITLE_MAX } from './nudges';
import { pickNow } from './planner';
import { initialState, reducer, type Action, type AppState } from './reducer';

// Local-time anchors, so the tests read the same in any timezone.
const NOW = new Date(2026, 9, 7, 8, 0); // Wed 7 Oct 2026, 08:00 local
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
const local = (dayOffset: number, h: number, m = 0) => new Date(2026, 9, 7 + dayOffset, h, m);

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

function withTasks(...titles: string[]): AppState {
  return run(initialState, ...titles.map((title, i) => ({ type: 'capture' as const, at: at(i), id: `t${i}`, title })));
}

const on = (s: AppState, patch = {}) => run(s, { type: 'set_nudges', at: at(0), patch: { enabled: true, ...patch } });
const task = (s: AppState, id: string) => s.tasks.find((t) => t.id === id)!;

test('clock text parses the ways people type it, always to the next occurrence', () => {
  assert.equal(parseClock('9:30pm', NOW)?.getTime(), local(0, 21, 30).getTime());
  assert.equal(parseClock('9 am', NOW)?.getTime(), local(0, 9).getTime());
  assert.equal(parseClock('7', NOW)?.getTime(), local(1, 7).getTime(), '7:00 has passed today, so tomorrow');
  assert.equal(parseClock('21:15', NOW)?.getTime(), local(0, 21, 15).getTime());
  assert.equal(parseClock('12am', NOW)?.getTime(), local(1, 0).getTime());
  for (const bad of ['soon', '25:00', '9:75', '13pm', '']) assert.equal(parseClock(bad, NOW), undefined, bad);
});

test('presets are all in the future and "this evening" disappears late in the day', () => {
  for (const p of timePresets(NOW)) assert.ok(p.at.getTime() > NOW.getTime(), p.label);
  assert.ok(!timePresets(local(0, 20)).some((p) => p.label === 'this evening'));
});

test('a time cue reads as a time, and says "tomorrow" when it is', () => {
  const s = run(withTasks('Write the report'), { type: 'set_intention', at: at(1), taskId: 't0', trigger: { kind: 'time', at: local(1, 9).toISOString() } });
  assert.match(cueText(task(s, 't0').intention!, s.tasks, NOW), /^At 9:00\s?AM tomorrow$/i);
});

test('a time already gone is refused', () => {
  const s = run(withTasks('Write the report'), { type: 'set_intention', at: at(10), taskId: 't0', trigger: { kind: 'time', at: at(5) } });
  assert.equal(task(s, 't0').intention, undefined);
});

test('the tick fires a time cue once its moment comes, and starting spends it', () => {
  let s = run(withTasks('Write the report', 'Do the dishes'), { type: 'set_intention', at: at(1), taskId: 't0', trigger: { kind: 'time', at: at(30) } });
  s = run(s, { type: 'tick', at: at(29) });
  assert.equal(task(s, 't0').intention?.firedAt, undefined);
  s = run(s, { type: 'tick', at: at(31) });
  assert.equal(task(s, 't0').intention?.firedAt, at(31));
  assert.equal(pickNow(s).task?.id, 't0');
  assert.equal(settleIntention(task(s, 't0')).intention, undefined);
});

test('nothing is planned until nudges are on', () => {
  const s = run(withTasks('Write the report'), { type: 'set_intention', at: at(1), taskId: 't0', trigger: { kind: 'time', at: at(60) } });
  assert.deepEqual(planNudges(s, at(2)), []);
  const planned = planNudges(on(s), at(2));
  assert.equal(planned.length, 1);
  assert.equal(planned[0].kind, 'intention');
  assert.equal(planned[0].at, at(60));
  assert.ok(planned[0].body.startsWith(task(s, 't0').firstStep.text.replace(/[.!]+$/, '')));
});

test('the daily nudge picks something that has sat for two days, and a different one tomorrow', () => {
  let s = on(withTasks('Call the dentist', 'Renew passport', 'Text Sam back'), { dailyAt: '10:00' });
  // Fresh tasks don't count as sitting.
  assert.deepEqual(planNudges(s, at(5)), []);
  const later = new Date(NOW.getTime() + 3 * 86_400_000);
  const plan = planNudges(s, later.toISOString());
  assert.equal(plan.length, 2);
  assert.ok(plan.every((n) => n.kind === 'resurface'));
  assert.notEqual(plan[0].taskId, plan[1].taskId);
  assert.match(plan[0].title, /still here|Still around|whenever you're ready/);
  assert.match(plan[0].body, /^First step: /);
  // Planned tasks are left to their own cue.
  s = run(s, { type: 'set_intention', at: at(6), taskId: 't0', trigger: { kind: 'event', text: 'I finish my coffee' } });
  assert.ok(!planNudges(s, later.toISOString()).some((n) => n.taskId === 't0'));
});

test('fried today means no extra nudge today; what you asked for still comes', () => {
  let s = on(withTasks('Call the dentist', 'Write the report'), { dailyAt: '23:00' });
  const later = new Date(NOW.getTime() + 3 * 86_400_000);
  s = run(s,
    { type: 'set_intention', at: later.toISOString(), taskId: 't1', trigger: { kind: 'time', at: new Date(later.getTime() + 3_600_000).toISOString() } },
    { type: 'set_energy', at: later.toISOString(), level: 'fried' });
  const plan = planNudges(s, later.toISOString());
  assert.ok(plan.some((n) => n.kind === 'intention'));
  assert.ok(!plan.some((n) => n.kind === 'resurface' && new Date(n.at).getDate() === later.getDate()));
});

test('never more than the daily cap, and the person’s own times win', () => {
  let s = on(withTasks(...Array.from({ length: 8 }, (_, i) => `Task number ${i}`)), { dailyAt: '23:30', maxPerDay: 6 });
  s = run(s, ...Array.from({ length: 8 }, (_, i) => ({
    type: 'set_intention' as const, at: at(10), taskId: `t${i}`, trigger: { kind: 'time' as const, at: local(0, 12, i).toISOString() },
  })));
  const plan = planNudges(s, at(20)).filter((n) => new Date(n.at).getDate() === NOW.getDate());
  assert.equal(plan.length, 6);
  assert.ok(plan.every((n) => n.kind === 'intention'));
});

test('long titles are clipped to fit a notification', () => {
  const long = 'Deal with the thing my manager mentioned in the meeting last Tuesday afternoon about quarterly numbers';
  const s = on(withTasks(long), { dailyAt: '10:00' });
  const plan = planNudges(s, new Date(NOW.getTime() + 3 * 86_400_000).toISOString());
  assert.ok(plan.length > 0);
  for (const n of plan) {
    assert.ok(n.title.length <= TITLE_MAX, n.title);
    assert.ok(n.body.length <= BODY_MAX, n.body);
  }
});

test('a bad daily time is ignored rather than stored', () => {
  const s = on(initialState, { dailyAt: '25:99' });
  assert.equal(s.nudges.dailyAt, undefined);
});
