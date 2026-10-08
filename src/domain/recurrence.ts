/**
 * Routines and the eternal recurrence question (docs/design/03-recurrence-triage-flow.md).
 * Pure functions; the reducer and the UI call into these.
 */
import type {
  EnergyLevel, ID, ISODateTime, LooseCadence, RecurrenceAnswer, Routine, Task, TaskEvent,
} from './model';

const DAY_MS = 86_400_000;

/** You can't affirm what you haven't lived yet. */
export const NEW_ROUTINE_GRACE_DAYS = 14;
/** Spaced like flashcards: each consecutive "yes" earns a longer rest from the question. */
export const YES_SPACING_DAYS = [7, 21, 60];
export const NO_OR_UNSURE_RETRY_DAYS = 7;
export const TOLL_REVIEW_DAYS = 90;
export const LINK_PROMPT_EVERY_DAYS = 30;
export const DISMISSALS_BEFORE_ASKING = 3;
/** End a session early if this share of answers is "no" (after at least two answers). */
export const MOSTLY_NO_RATIO = 0.6;

export function addDays(at: ISODateTime, days: number): ISODateTime {
  return new Date(Date.parse(at) + days * DAY_MS).toISOString();
}

/** Local calendar date, "2026-10-07". */
export function localDay(at: ISODateTime): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetweenLocal(a: ISODateTime, b: ISODateTime): number {
  const [ay, am, ad] = localDay(a).split('-').map(Number);
  const [by, bm, bd] = localDay(b).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

export const CADENCE_DAYS: Record<LooseCadence, number> = { daily: 1, few_per_week: 2, weekly: 7, monthly: 30 };
export const CADENCE_ORDER: LooseCadence[] = ['daily', 'few_per_week', 'weekly', 'monthly'];

export function looserCadence(c: LooseCadence): LooseCadence {
  return CADENCE_ORDER[Math.min(CADENCE_ORDER.indexOf(c) + 1, CADENCE_ORDER.length - 1)];
}

/**
 * Obligations to other people, and the plain costs of being alive. Asking
 * "would you keep picking up your kid?" would be grotesque, so these start as tolls.
 */
const TOLL = /\b(kids?|child(ren)?|son|daughter|school|pick ?up|drop ?off|meds|medication|pills|feed the (dog|cat)|walk the dog|rent|mortgage|tax(es)?|bills?|insurance)\b/i;

export function isLikelyToll(title: string): boolean {
  return TOLL.test(title);
}

export function newRoutine(id: ID, title: string, cadence: LooseCadence, at: ISODateTime): Routine {
  return {
    id,
    createdAt: at,
    updatedAt: at,
    title: title.trim().replace(/\s+/g, ' '),
    cadence,
    nature: isLikelyToll(title) ? 'toll' : 'unknown',
    becomingIds: [],
    status: 'active',
    recurrence: {
      nextEligibleAt: addDays(at, NEW_ROUTINE_GRACE_DAYS),
      consecutiveYes: 0,
      standing: 'unasked',
    },
  };
}

function hasActiveOccurrence(routine: Routine, tasks: Task[]): boolean {
  return tasks.some((t) => t.routineId === routine.id && (t.state === 'open' || t.state === 'started'));
}

/** A routine spawns its next task once the previous one is done and enough calendar days have passed. */
export function isRoutineDue(routine: Routine, tasks: Task[], now: ISODateTime): boolean {
  if (routine.status !== 'active' || hasActiveOccurrence(routine, tasks)) return false;
  if (!routine.lastDoneAt) return true;
  return daysBetweenLocal(routine.lastDoneAt, now) >= CADENCE_DAYS[routine.cadence];
}

export function isEligibleForQuestion(r: Routine, now: ISODateTime): boolean {
  if (r.status !== 'active') return false;
  if (Date.parse(r.recurrence.nextEligibleAt) > Date.parse(now)) return false;
  if (r.nature === 'toll' && r.recurrence.lastAskedAt) {
    return Date.parse(now) - Date.parse(r.recurrence.lastAskedAt) >= TOLL_REVIEW_DAYS * DAY_MS;
  }
  return true;
}

interface ScoreInput {
  tasks: Task[];
  events: TaskEvent[];
  lastFollowUp?: string;
}

/** Higher = ask sooner. The data is often already asking the question. */
export function scoreRoutine(r: Routine, { tasks, events, lastFollowUp }: ScoreInput, now: ISODateTime): number {
  let score = 0;
  if (r.recurrence.standing === 'unasked') score += 3;
  const occurrenceIds = new Set(tasks.filter((t) => t.routineId === r.id).map((t) => t.id));
  const since = Date.parse(now) - 30 * DAY_MS;
  const slips = events.filter((e) => e.type === 'slipped' && occurrenceIds.has(e.taskId) && Date.parse(e.at) >= since).length;
  if (slips >= 3) score += 3;
  if (r.becomingIds.length === 0) score += 1;
  if (lastFollowUp === 'keep_anyway') score += 1;
  return score;
}

export interface QuestionState {
  routines: Routine[];
  tasks: Task[];
  events: TaskEvent[];
  verdicts: { routineId: ID; followUp?: string; askedAt: ISODateTime }[];
  recurrence: { enabled: boolean; maxQuestionsPerSession: number; lastSessionDay?: string; lastSessionMoment?: 'win' | 'neutral' };
  energy?: EnergyLevel;
}

export function selectQuestions(s: QuestionState, now: ISODateTime): Routine[] {
  if (!s.recurrence.enabled) return [];
  const lastFollowUp = (id: ID) =>
    [...s.verdicts].reverse().find((v) => v.routineId === id)?.followUp;
  return s.routines
    .filter((r) => isEligibleForQuestion(r, now))
    .map((r) => ({ r, score: scoreRoutine(r, { tasks: s.tasks, events: s.events, lastFollowUp: lastFollowUp(r.id) }, now) }))
    .sort((a, b) =>
      b.score - a.score ||
      (Date.parse(a.r.recurrence.lastAskedAt ?? a.r.createdAt) - Date.parse(b.r.recurrence.lastAskedAt ?? b.r.createdAt)))
    .slice(0, s.recurrence.maxQuestionsPerSession)
    .map((x) => x.r);
}

export function completedToday(events: TaskEvent[], now: ISODateTime): boolean {
  const today = localDay(now);
  return events.some((e) => e.type === 'completed' && localDay(e.at) === today);
}

/**
 * Moments alternate. Right after the day's first completion the question is cheap to
 * reach, but the good mood inflates "yes" (Schwarz & Clore, 1983). So the next session
 * comes at a neutral moment instead: before any win today, on a day that isn't low.
 * Never on a fried day, never twice in a day.
 */
export function shouldOfferSession(s: QuestionState, now: ISODateTime): boolean {
  if (!s.recurrence.enabled || s.energy === 'fried') return false;
  if (s.recurrence.lastSessionDay === localDay(now)) return false;
  const won = completedToday(s.events, now);
  const moment = s.recurrence.lastSessionMoment === 'win'
    ? !won && s.energy !== 'low'
    : won;
  return moment && selectQuestions(s, now).length > 0;
}

export function applyAnswer(r: Routine, answer: RecurrenceAnswer, at: ISODateTime): Routine {
  const rec = { ...r.recurrence };
  if (answer === 'skipped') return r;
  rec.lastAskedAt = at;
  if (answer === 'yes') {
    rec.consecutiveYes += 1;
    rec.standing = 'affirmed';
    rec.nextEligibleAt = addDays(at, YES_SPACING_DAYS[Math.min(rec.consecutiveYes, YES_SPACING_DAYS.length) - 1]);
  } else {
    rec.consecutiveYes = 0;
    rec.standing = 'questioned';
    rec.nextEligibleAt = addDays(at, NO_OR_UNSURE_RETRY_DAYS);
  }
  return { ...r, recurrence: rec, updatedAt: at };
}

/** After a "yes", ask "Who does this make you?" at most once a month per routine, and only if unlinked. */
export function shouldAskForLink(r: Routine, hasBecomings: boolean, now: ISODateTime): boolean {
  if (!hasBecomings || r.becomingIds.length > 0) return false;
  const last = r.recurrence.lastLinkPromptAt;
  return !last || Date.parse(now) - Date.parse(last) >= LINK_PROMPT_EVERY_DAYS * DAY_MS;
}

/** "14 of 17 routines are ones you'd live again." Tolls are accepted, not chosen, so they don't count either way. */
export function affirmedShare(routines: Routine[]): { affirmed: number; total: number } {
  const live = routines.filter((r) => r.status === 'active' && r.nature !== 'toll');
  return {
    affirmed: live.filter((r) => r.recurrence.standing === 'affirmed').length,
    total: live.length,
  };
}

/** A "no" from someone who said yes three times before, on a low-energy day, may be the mood talking. */
export function mightBeTheMood(r: Routine, energy: EnergyLevel | undefined): boolean {
  return (energy === 'low' || energy === 'fried') && r.recurrence.consecutiveYes >= 3;
}
