/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanCue, intentionSentence, obstacleSentence } from './intention';
import { pickNow } from './planner';
import { initialState, reducer, type Action, type AppState } from './reducer';

const T0 = Date.parse('2026-10-07T09:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

function withTasks(...titles: string[]): AppState {
  return run(initialState, ...titles.map((title, i) => ({ type: 'capture' as const, at: at(i), id: `t${i}`, title })));
}

const task = (s: AppState, id: string) => s.tasks.find((t) => t.id === id)!;

test('cues are cleaned of a typed "when" and trailing punctuation', () => {
  assert.equal(cleanCue('  When I finish my coffee. '), 'I finish my coffee');
  assert.equal(cleanCue('after lunch is over,'), 'lunch is over');
  assert.equal(cleanCue('as soon as I get home'), 'I get home');
});

test('the sentence reads as one plan and follows the current first step', () => {
  let s = withTasks('Write the quarterly report');
  s = run(s, { type: 'set_intention', at: at(5), taskId: 't0', trigger: { kind: 'event', text: 'when I finish my coffee' }, context: 'at my desk' });
  const step = task(s, 't0').firstStep.text;
  assert.equal(intentionSentence(task(s, 't0'), s.tasks), `When I finish my coffee, at my desk, I'll ${step[0].toLowerCase()}${step.slice(1)}.`);
  s = run(s, { type: 'edit_step', at: at(6), taskId: 't0', text: 'Open the report doc' });
  assert.equal(intentionSentence(task(s, 't0'), s.tasks), "When I finish my coffee, at my desk, I'll open the report doc.");
});

test('obstacle plans read as if-then, whatever the person typed', () => {
  assert.equal(
    obstacleSentence({ trigger: { kind: 'event', text: 'x' }, setAt: at(0), ifObstacle: { obstacle: 'If I open Twitter', response: "then I'll close it and type one bullet." } }),
    "If I open Twitter, then I'll close it and type one bullet.",
  );
  assert.equal(
    obstacleSentence({ trigger: { kind: 'event', text: 'x' }, setAt: at(0), ifObstacle: { obstacle: 'pick up my phone instead', response: 'put it face down' } }),
    "If I pick up my phone instead, then I'll put it face down.",
  );
});

test('a planned task waits for its cue, then jumps the queue when it fires', () => {
  let s = withTasks('Write the quarterly report', 'Text Sam back');
  s = run(s, { type: 'set_intention', at: at(5), taskId: 't0', trigger: { kind: 'event', text: 'I finish my coffee' } });
  assert.equal(pickNow(s).task?.id, 't1', 'waiting on a cue, so the other task is up');
  s = run(s, { type: 'fire_intention', at: at(20), taskId: 't0' });
  const pick = pickNow(s);
  assert.equal(pick.task?.id, 't0');
  assert.equal(pick.reason, 'you planned this');
});

test('a fired cue beats energy fit, and is not counted as held back', () => {
  let s = withTasks('Write the quarterly report');
  s = run(s,
    { type: 'set_energy', at: at(1), level: 'low' },
    { type: 'set_intention', at: at(2), taskId: 't0', trigger: { kind: 'event', text: 'I sit down at my desk' } });
  assert.equal(pickNow(s).task, undefined);
  assert.equal(pickNow(s).heldBack, 1);
  s = run(s, { type: 'fire_intention', at: at(3), taskId: 't0' });
  assert.equal(pickNow(s).task?.id, 't0');
  assert.equal(pickNow(s).heldBack, 0);
});

test('event cues re-arm after "not now"; the plan itself stays', () => {
  let s = withTasks('Write the quarterly report');
  s = run(s,
    { type: 'set_intention', at: at(1), taskId: 't0', trigger: { kind: 'event', text: 'I finish my coffee' } },
    { type: 'fire_intention', at: at(2), taskId: 't0' },
    { type: 'not_now', at: at(3), taskId: 't0' });
  assert.ok(task(s, 't0').intention);
  assert.equal(task(s, 't0').intention?.firedAt, undefined);
});

test('"after X" fires when X is done, and is spent once used', () => {
  let s = withTasks('Send the invoice', 'Do the dishes');
  s = run(s, { type: 'set_intention', at: at(1), taskId: 't1', trigger: { kind: 'after_task', taskId: 't0' } });
  assert.match(intentionSentence(task(s, 't1'), s.tasks), /^After send the invoice, I'll /);
  s = run(s, { type: 'complete', at: at(10), taskId: 't0' });
  assert.equal(task(s, 't1').intention?.firedAt, at(10));
  assert.ok(s.events.some((e) => e.taskId === 't1' && e.type === 'intention_fired'));
  assert.equal(pickNow(s).task?.id, 't1');
  s = run(s, { type: 'open', at: at(11), taskId: 't1' }, { type: 'first_step_done', at: at(12), taskId: 't1' });
  assert.equal(task(s, 't1').intention, undefined);
});

test('releasing the anchor drops the "after" plan but keeps the task', () => {
  let s = withTasks('Send the invoice', 'Do the dishes');
  s = run(s,
    { type: 'set_intention', at: at(1), taskId: 't1', trigger: { kind: 'after_task', taskId: 't0' } },
    { type: 'release', at: at(2), taskId: 't0' });
  assert.equal(task(s, 't1').intention, undefined);
  assert.equal(task(s, 't1').state, 'open');
});

test('bad plans are refused: empty cue, self-anchor, finished anchor', () => {
  const s = run(withTasks('Send the invoice', 'Do the dishes'), { type: 'complete', at: at(1), taskId: 't0' });
  for (const trigger of [
    { kind: 'event' as const, text: '  when ' },
    { kind: 'after_task' as const, taskId: 't1' },
    { kind: 'after_task' as const, taskId: 't0' },
  ]) {
    assert.equal(task(run(s, { type: 'set_intention', at: at(2), taskId: 't1', trigger }), 't1').intention, undefined);
  }
});

test('a half-filled obstacle plan is dropped rather than shown half-written', () => {
  const s = run(withTasks('Write the report'), {
    type: 'set_intention', at: at(1), taskId: 't0', trigger: { kind: 'event', text: 'I sit down' }, ifObstacle: { obstacle: 'I open Twitter', response: ' ' },
  });
  assert.equal(task(s, 't0').intention?.ifObstacle, undefined);
});
