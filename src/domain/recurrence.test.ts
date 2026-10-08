/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays, affirmedShare, isLikelyToll, mightBeTheMood, NEW_ROUTINE_GRACE_DAYS, selectQuestions,
  shouldAskForLink, shouldOfferSession, TOLL_REVIEW_DAYS, YES_SPACING_DAYS,
} from './recurrence';
import { initialState, migrate, reducer, type Action, type AppState } from './reducer';

// 09:00 local, so "same day" means the same day wherever the tests run.
const t0 = new Date(2026, 9, 7, 9).toISOString();
const day = (n: number, hour = 9) => new Date(Date.parse(t0) + n * 86_400_000 + (hour - 9) * 3_600_000).toISOString();

type NoAt<A> = A extends unknown ? Omit<A, 'at'> : never;
const run = (s: AppState, at: string, ...actions: NoAt<Action>[]) =>
  actions.reduce((acc, a) => reducer(acc, { ...a, at } as Action), s);

function withRoutines(...titles: string[]): AppState {
  let s = run(initialState, t0, { type: 'set_recurrence_enabled', enabled: true });
  titles.forEach((title, i) => {
    s = run(s, t0, { type: 'add_routine', id: `r${i}`, title, cadence: 'daily' });
  });
  return s;
}

test('a routine spawns one task right away, and the next only after it is done and a day has passed', () => {
  let s = withRoutines('Morning pages');
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].routineId, 'r0');
  s = run(s, day(0, 12), { type: 'tick' });
  assert.equal(s.tasks.length, 1, 'no duplicate while one is open');
  s = run(s, day(0, 13), { type: 'complete', taskId: s.tasks[0].id });
  s = run(s, day(0, 20), { type: 'tick' });
  assert.equal(s.tasks.length, 1, 'not again the same day');
  s = run(s, day(1, 7), { type: 'tick' });
  assert.equal(s.tasks.length, 2);
  assert.equal(s.tasks[1].state, 'open');
});

test('new routines are not questioned for two weeks', () => {
  const s = withRoutines('Morning pages');
  assert.equal(selectQuestions(s, day(NEW_ROUTINE_GRACE_DAYS - 1)).length, 0);
  assert.equal(selectQuestions(s, day(NEW_ROUTINE_GRACE_DAYS)).length, 1);
});

test('the question is off until opted in, and only offered after the day\'s first completion', () => {
  let s = run(initialState, t0, { type: 'add_routine', id: 'r0', title: 'Morning pages', cadence: 'daily' });
  const later = day(NEW_ROUTINE_GRACE_DAYS);
  assert.equal(shouldOfferSession(s, later), false, 'off by default');
  s = run(s, t0, { type: 'set_recurrence_enabled', enabled: true });
  s = run(s, later, { type: 'tick' });
  assert.equal(shouldOfferSession(s, later), false, 'no completion yet today');
  s = run(s, later, { type: 'capture', id: 'x', title: 'Text Sam back' }, { type: 'complete', taskId: 'x' });
  assert.equal(shouldOfferSession(s, later), true);
  s = run(s, later, { type: 'set_energy', level: 'fried' });
  assert.equal(shouldOfferSession(s, later), false, 'never on a fried day');
  s = run(s, later, { type: 'set_energy', level: undefined }, { type: 'start_recurrence_session' });
  assert.equal(shouldOfferSession(s, later), false, 'once a day');
});

test('after a session that rode a win, the next one comes at a neutral moment instead', () => {
  let s = withRoutines('Morning pages', 'Stretch', 'Journal', 'A walk');
  const d1 = day(NEW_ROUTINE_GRACE_DAYS);
  s = run(s, d1, { type: 'capture', id: 'x', title: 'Text Sam back' }, { type: 'complete', taskId: 'x' }, { type: 'start_recurrence_session' });
  assert.equal(s.recurrence.lastSessionMoment, 'win');
  const d2 = day(NEW_ROUTINE_GRACE_DAYS + 1);
  assert.equal(shouldOfferSession(s, d2), true, 'neutral: no win yet today');
  s = run(s, d2, { type: 'set_energy', level: 'low' });
  assert.equal(shouldOfferSession(s, d2), false, 'a low day is not neutral');
  s = run(s, d2, { type: 'set_energy', level: 'medium' }, { type: 'capture', id: 'y', title: 'Text Ana back' }, { type: 'complete', taskId: 'y' });
  assert.equal(shouldOfferSession(s, d2), false, 'already won today: wait for a neutral moment');
  const d3 = day(NEW_ROUTINE_GRACE_DAYS + 2);
  s = run(s, d3, { type: 'start_recurrence_session' });
  assert.equal(s.recurrence.lastSessionMoment, 'neutral');
  const d4 = day(NEW_ROUTINE_GRACE_DAYS + 3);
  assert.equal(shouldOfferSession(s, d4), false, 'and then back to riding a win');
});

test('yes answers are spaced 7, 21, then 60 days apart', () => {
  let s = withRoutines('Morning pages');
  let at = day(NEW_ROUTINE_GRACE_DAYS);
  for (const gap of [...YES_SPACING_DAYS, YES_SPACING_DAYS.at(-1)!]) {
    assert.equal(selectQuestions(s, at).length, 1);
    s = run(s, at, { type: 'answer_recurrence', id: `v${at}`, routineId: 'r0', answer: 'yes' });
    assert.equal(s.routines[0].recurrence.nextEligibleAt, addDays(at, gap));
    assert.equal(selectQuestions(s, addDays(at, gap - 1)).length, 0);
    at = addDays(at, gap);
  }
  assert.equal(s.routines[0].recurrence.standing, 'affirmed');
});

test('at most N per session, and the unasked and slipping ones come first', () => {
  let s = withRoutines('A walk', 'Journal', 'Stretch', 'Read philosophy');
  const at = day(NEW_ROUTINE_GRACE_DAYS);
  s = run(s, at, { type: 'answer_recurrence', id: 'v0', routineId: 'r0', answer: 'yes' });
  // Make r3's occurrence slip three times.
  const r3task = s.tasks.find((t) => t.routineId === 'r3')!;
  for (let i = 0; i < 3; i++) s = run(s, addDays(at, 8), { type: 'not_now', taskId: r3task.id });
  const picked = selectQuestions(s, addDays(at, 8)).map((r) => r.id);
  assert.equal(picked.length, 3);
  assert.equal(picked[0], 'r3');
  s = run(s, at, { type: 'set_recurrence_frequency', choice: 'less' });
  assert.equal(selectQuestions(s, addDays(at, 8)).length, 1);
});

test('"no" follow-ups: make rarer, toll, release, reshape', () => {
  let s = withRoutines('Gym every day', 'Weekly call', 'Inbox zero', 'Long run');
  const at = day(NEW_ROUTINE_GRACE_DAYS);
  for (const id of ['r0', 'r1', 'r2', 'r3']) s = run(s, at, { type: 'answer_recurrence', id: `v-${id}`, routineId: id, answer: 'no' });
  s = run(s, at,
    { type: 'follow_up_recurrence', routineId: 'r0', followUp: 'make_rarer' },
    { type: 'follow_up_recurrence', routineId: 'r1', followUp: 'mark_toll_and_lighten' },
    { type: 'follow_up_recurrence', routineId: 'r2', followUp: 'release' },
    { type: 'reshape_routine', routineId: 'r3', title: 'Short run' },
  );
  const [r0, r1, r2, r3] = s.routines;
  assert.equal(r0.cadence, 'few_per_week');
  assert.equal(r1.nature, 'toll');
  assert.equal(r2.status, 'released');
  assert.equal(s.tasks.find((t) => t.routineId === 'r2')?.state, 'released');
  assert.equal(r3.title, 'Short run');
  assert.equal(s.tasks.find((t) => t.routineId === 'r3')?.title, 'Short run');
  assert.equal(s.verdicts.find((v) => v.routineId === 'r0')?.followUp, 'make_rarer');
  assert.deepEqual(affirmedShare(s.routines), { affirmed: 0, total: 2 }, 'released and toll routines are not counted');
  // Tolls are asked again only after 90 days.
  assert.equal(selectQuestions(s, addDays(at, 30)).some((r) => r.id === 'r1'), false);
  assert.equal(selectQuestions(s, addDays(at, TOLL_REVIEW_DAYS)).some((r) => r.id === 'r1'), true);
});

test('obligations to other people start as tolls', () => {
  assert.equal(isLikelyToll('Pick up kids from school'), true);
  assert.equal(isLikelyToll('Give mom her meds'), true);
  assert.equal(isLikelyToll('Morning pages'), false);
});

test('identity link is offered once a month, only for unlinked routines', () => {
  let s = withRoutines('Morning pages');
  s = run(s, t0, { type: 'add_becoming', id: 'b0', statement: 'someone who writes every week' });
  const r = () => s.routines[0];
  assert.equal(shouldAskForLink(r(), true, t0), true);
  s = run(s, t0, { type: 'link_routine_becoming', routineId: 'r0', becomingId: null });
  assert.equal(shouldAskForLink(r(), true, day(10)), false);
  assert.equal(shouldAskForLink(r(), true, day(30)), true);
  s = run(s, day(30), { type: 'link_routine_becoming', routineId: 'r0', becomingId: 'b0' });
  assert.deepEqual(s.tasks[0].becomingIds, ['b0']);
  assert.equal(shouldAskForLink(r(), true, day(90)), false);
});

test('a "no" after three yeses on a low day might be the mood', () => {
  let s = withRoutines('Morning pages');
  let at = day(NEW_ROUTINE_GRACE_DAYS);
  for (let i = 0; i < 3; i++) {
    s = run(s, at, { type: 'answer_recurrence', id: `v${i}`, routineId: 'r0', answer: 'yes' });
    at = addDays(at, 61);
  }
  assert.equal(mightBeTheMood(s.routines[0], 'low'), true);
  assert.equal(mightBeTheMood(s.routines[0], 'high'), false);
});

test('becomings: at most three active; outgrowing frees a slot', () => {
  let s = initialState;
  for (let i = 0; i < 4; i++) s = run(s, t0, { type: 'add_becoming', id: `b${i}`, statement: `self ${i}` });
  assert.equal(s.becomings.length, 3);
  s = run(s, t0, { type: 'outgrow_becoming', id: 'b0' }, { type: 'add_becoming', id: 'b3', statement: 'self 3' });
  assert.equal(s.becomings.filter((b) => b.status === 'active').length, 3);
});

test('state saved by the first slice still loads', () => {
  const old = { version: 1 as const, tasks: [], events: [], profile: initialState.profile };
  const s = migrate(old);
  assert.deepEqual(s.routines, []);
  assert.equal(s.recurrence.enabled, false);
  assert.equal(s.onboarding.completedAt, undefined);
});
