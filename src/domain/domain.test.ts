/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { categorize, extractObject, extractRecipient, inferEnergy } from './classify';
import { estimateDuration, toExperiential, updateCalibration } from './duration';
import { generateFirstStep, nextAlternative, RESHAPE_DEPTH, shrinkFirstStep, validateFirstStep } from './firstStep';
import { pickNow, RESURFACE_HIDDEN_DAYS } from './planner';
import { initialState, reducer, SLIP_PROMPT_AFTER, type AppState } from './reducer';

const profile = initialState.profile;

const SAMPLE_TITLES = [
  'fix computer',
  'Repair the bike',
  'Write email draft to landlord',
  'Do taxes',
  'Clean the kitchen',
  'Do the dishes',
  'Do laundry',
  'Finish chapter 4',
  'Call the dentist',
  'Go to the gym',
  'Text Sam back',
  'Buy groceries',
  'Read the Nietzsche book',
  'Renew passport',
  'Plan the birthday party',
  'Figure out what to do about the car',
  'asdf',
  'Deal with the thing my manager mentioned in the meeting last Tuesday afternoon about quarterly numbers',
];

test('every generated first step and every shrink passes the six rules', () => {
  for (const title of SAMPLE_TITLES) {
    let step = generateFirstStep(title, profile);
    for (const text of [step.text, ...(step.alternatives ?? [])]) {
      const v = validateFirstStep(text);
      assert.ok(v.ok, `"${title}" → "${text}": ${v.reasons.join(', ')}`);
    }
    for (let i = 0; i < RESHAPE_DEPTH; i++) {
      const smaller = shrinkFirstStep(title, step, profile);
      if (!smaller) break;
      assert.ok(validateFirstStep(smaller.text).ok, `shrink of "${title}" → "${smaller.text}"`);
      step = smaller;
    }
  }
});

test('the spec example: email draft becomes opening mail and typing the subject line', () => {
  const step = generateFirstStep('Write email draft to landlord', { ...profile, knownTools: { mail: 'Gmail' } });
  assert.equal(step.text, 'Open Gmail and type the subject line');
  assert.ok(step.alternatives?.includes('Type "Hi landlord" and nothing else'));
});

test('validator rejects promises, decisions and long steps', () => {
  assert.equal(validateFirstStep('Start the report').ok, false);
  assert.equal(validateFirstStep('Think about the email').ok, false);
  assert.equal(validateFirstStep('Open the doc and decide the outline').ok, false);
  assert.equal(validateFirstStep('Open the doc and then type a long list of every single thing you can think of').ok, false);
  assert.equal(validateFirstStep('Open the report doc').ok, true);
});

test('classification', () => {
  assert.equal(categorize('email the dentist'), 'email');
  assert.equal(categorize('Call mom'), 'call');
  assert.equal(categorize('Call the dentist'), 'call');
  assert.equal(categorize('Read the Nietzsche book'), 'read');
  // "bike" is not exercise; fixing it is a repair.
  assert.equal(categorize('Fix the bike'), 'fix');
  assert.equal(inferEnergy('Write email draft to landlord'), 'medium');
  assert.equal(inferEnergy('Write the thesis intro'), 'deep');
  assert.equal(inferEnergy('Do laundry'), 'autopilot');
  assert.equal(extractObject('I need to write the grant proposal'), 'the grant proposal');
  assert.equal(extractRecipient('Write email draft to landlord'), 'landlord');
  assert.equal(extractRecipient('Call the dentist'), 'the dentist');
});

test('durations are shown in lived units with generous buffers', () => {
  assert.equal(toExperiential(4).label, 'about one song');
  assert.equal(toExperiential(45).label, 'about one laundry cycle');
  assert.equal(toExperiential(44).label, 'about two sitcom episodes');
  const d = estimateDuration(20, 1.5);
  assert.equal(d.plannedMinutes, 30);
});

const t0 = '2026-10-07T09:00:00.000Z';
const plus = (sec: number) => new Date(Date.parse(t0) + sec * 1000).toISOString();

function withTasks(...titles: string[]): AppState {
  return titles.reduce<AppState>(
    (s, title, i) => reducer(s, { type: 'capture', at: plus(i), id: `t${i}`, title }),
    initialState,
  );
}

test('start latency is measured from first open to first step done', () => {
  let s = withTasks('Write email draft to landlord');
  s = reducer(s, { type: 'open', at: plus(10), taskId: 't0' });
  s = reducer(s, { type: 'open', at: plus(50), taskId: 't0' }); // re-render: ignored
  s = reducer(s, { type: 'first_step_done', at: plus(105), taskId: 't0' });
  const task = s.tasks[0];
  assert.equal(task.state, 'started');
  assert.equal(task.stats.lastStartLatencySec, 95);
  assert.deepEqual(s.events.at(-1)?.meta, { latencySec: 95 });
});

test('calibration learns slowly from one-sitting tasks and keeps its buffer', () => {
  assert.equal(updateCalibration(1.5, 20, 60), 1.8); // took 3x the guess
  assert.equal(updateCalibration(1.5, 20, 5), 1.25); // faster than guessed
  assert.equal(updateCalibration(1, 20, 2), 1); // never below the raw guess
  assert.equal(updateCalibration(1.5, 20, 600), 1.5); // left open all day: ignored
  assert.equal(updateCalibration(1.5, 20, 0.2), 1.5); // mis-tap: ignored
});

test('completing in one sitting updates that energy tier; a paused task does not', () => {
  let s = withTasks('Write email draft to landlord');
  const tier = s.tasks[0].energy;
  const raw = s.tasks[0].duration.rawMinutes;
  s = reducer(s, { type: 'first_step_done', at: plus(0), taskId: 't0' });
  s = reducer(s, { type: 'complete', at: plus(raw * 3 * 60), taskId: 't0' });
  assert.equal(s.profile.estimateCalibration[tier], updateCalibration(1.5, raw, raw * 3));

  let p = withTasks('Write email draft to landlord');
  p = reducer(p, { type: 'first_step_done', at: plus(0), taskId: 't0' });
  p = reducer(p, { type: 'pause', at: plus(60), taskId: 't0' });
  p = reducer(p, { type: 'complete', at: plus(raw * 3 * 60), taskId: 't0' });
  assert.equal(p.profile.estimateCalibration[tier], 1.5);
});

test('a heavy task hidden on low days for a week comes back once, at its smallest step', () => {
  let s = withTasks('Write the essay', 'Do the dishes');
  s = reducer(s, { type: 'set_energy', at: plus(5), level: 'low' });
  assert.equal(pickNow(s, plus(10)).task?.title, 'Do the dishes');
  const later = plus(RESURFACE_HIDDEN_DAYS * 86_400 + 60);
  const pick = pickNow(s, later);
  assert.equal(pick.task?.title, 'Write the essay');
  assert.equal(pick.reason, "it's been resting a while");
  s = reducer(s, { type: 'open', at: later, taskId: 't0' });
  assert.equal(s.tasks[0].firstStep.shrinkDepth, 2);
  // Seen now: it rests again rather than taking the card every visit.
  s = reducer(s, { type: 'not_now', at: plus(RESURFACE_HIDDEN_DAYS * 86_400 + 120), taskId: 't0' });
  assert.equal(pickNow(s, plus(RESURFACE_HIDDEN_DAYS * 86_400 + 5 * 3600)).task?.title, 'Do the dishes');
});

test('a start after the app was backgrounded is logged without a latency', () => {
  let s = withTasks('Write email draft to landlord');
  s = reducer(s, { type: 'open', at: plus(10), taskId: 't0' });
  s = reducer(s, { type: 'backgrounded', at: plus(20) });
  s = reducer(s, { type: 'first_step_done', at: plus(4000), taskId: 't0' });
  assert.equal(s.tasks[0].state, 'started');
  assert.equal(s.tasks[0].stats.lastStartLatencySec, undefined);
  assert.equal(s.events.at(-1)?.meta, undefined);
});

test('a fresh open after "not now" measures latency again, even if the app was backgrounded before', () => {
  let s = withTasks('Write email draft to landlord');
  s = reducer(s, { type: 'open', at: plus(10), taskId: 't0' });
  s = reducer(s, { type: 'backgrounded', at: plus(20) });
  s = reducer(s, { type: 'not_now', at: plus(30), taskId: 't0' });
  s = reducer(s, { type: 'open', at: plus(100), taskId: 't0' });
  s = reducer(s, { type: 'first_step_done', at: plus(130), taskId: 't0' });
  assert.deepEqual(s.events.at(-1)?.meta, { latencySec: 30 });
});

test('"not now" three times raises the slip question, and the task goes to the back', () => {
  let s = withTasks('Do taxes', 'Clean the kitchen');
  for (let i = 1; i <= SLIP_PROMPT_AFTER; i++) {
    s = reducer(s, { type: 'not_now', at: plus(100 * i), taskId: 't0' });
    assert.equal(s.tasks[0].slipPromptPending, i === SLIP_PROMPT_AFTER);
  }
  assert.equal(pickNow(s).task?.id, 't1');
  s = reducer(s, { type: 'keep_anyway', at: plus(500), taskId: 't0' });
  assert.equal(s.tasks[0].slipPromptPending, false);
});

test('shrinking past the ladder turns into the reshape question instead of an even smaller step', () => {
  let s = withTasks('Do taxes');
  const seen = [s.tasks[0].firstStep.text];
  for (let i = 0; i < RESHAPE_DEPTH; i++) {
    s = reducer(s, { type: 'shrink', at: plus(10 + i), taskId: 't0' });
    seen.push(s.tasks[0].firstStep.text);
  }
  assert.equal(new Set(seen.slice(0, RESHAPE_DEPTH)).size, RESHAPE_DEPTH);
  assert.equal(s.tasks[0].slipPromptPending, true);
});

test('energy decides what reaches the Now card', () => {
  let s = withTasks('Write the thesis intro', 'Do laundry');
  s = reducer(s, { type: 'set_energy', at: plus(5), level: 'high' });
  assert.equal(pickNow(s).task?.id, 't0');
  s = reducer(s, { type: 'set_energy', at: plus(6), level: 'fried' });
  const pick = pickNow(s);
  assert.equal(pick.task?.id, 't1');
  assert.equal(pick.heldBack, 1);
  s = reducer(s, { type: 'pin_now', at: plus(7), taskId: 't0' });
  assert.equal(pickNow(s).task?.id, 't0');
});

test('released and done tasks leave the Now card; alternatives cycle', () => {
  let s = withTasks('Call the dentist');
  const first = s.tasks[0].firstStep;
  const cycled = nextAlternative(nextAlternative(nextAlternative(first)));
  assert.equal(cycled.text, first.text);
  s = reducer(s, { type: 'release', at: plus(5), taskId: 't0' });
  assert.equal(pickNow(s).task, undefined);
});

test('stopping after the first step is a pause, not a slip', () => {
  let s = withTasks('Finish chapter 4', 'Do laundry');
  s = reducer(s, { type: 'first_step_done', at: plus(5), taskId: 't0' });
  assert.equal(pickNow(s).task?.id, 't0'); // momentum: started work comes back first
  s = reducer(s, { type: 'pause', at: plus(6), taskId: 't0' });
  assert.equal(s.tasks[0].stats.timesSlipped, 0);
  assert.equal(s.tasks[0].state, 'started');
  assert.equal(pickNow(s).task?.id, 't1');
});

test('admin steps never double the article: "Send the invoice" is not "the the invoice"', () => {
  const step = generateFirstStep('Send the invoice', profile);
  for (const text of [step.text, ...(step.alternatives ?? [])]) assert.doesNotMatch(text, /\bthe the\b/i);
});

test('every rung of the ladder still points at the task', () => {
  const p = initialState.profile;
  let step = generateFirstStep('fix computer', p);
  assert.match(step.text, /computer/);
  for (let i = 0; i < RESHAPE_DEPTH; i++) {
    const smaller = shrinkFirstStep('fix computer', step, p);
    if (!smaller) break;
    assert.match(smaller.text, /computer/, smaller.text);
    step = smaller;
  }
  let generic = generateFirstStep('asdf qwerty', p);
  for (let i = 0; i < RESHAPE_DEPTH; i++) {
    const smaller = shrinkFirstStep('asdf qwerty', generic, p);
    if (!smaller) break;
    assert.match(smaller.text, /asdf qwerty/, smaller.text);
    generic = smaller;
  }
});

test('"not now" sets a task aside for a few hours, even when it fits the energy best', () => {
  let s = withTasks('Do the dishes', 'Call the dentist');
  const t = (h: number) => new Date(Date.parse('2026-10-07T09:00:00Z') + h * 3_600_000).toISOString();
  s = reducer(s, { type: 'set_energy', at: t(0), level: 'low' });
  const dishes = s.tasks.find((x) => x.title === 'Do the dishes')!;
  assert.equal(pickNow(s, t(0)).task?.id, dishes.id, 'autopilot fits low energy best');
  s = reducer(s, { type: 'pause', at: t(0), taskId: dishes.id });
  assert.notEqual(pickNow(s, t(1)).task?.id, dishes.id, 'set aside right after "stop here"');
  assert.equal(pickNow(s, t(5)).task?.id, dishes.id, 'back once the few hours pass');
});
