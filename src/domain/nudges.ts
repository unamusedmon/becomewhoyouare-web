/**
 * Which notifications to schedule, as a pure function of state and time. The phone
 * gets the whole plan again whenever it changes, so nothing here keeps its own memory.
 *
 * Rules (docs/design/04 "Notifications", 05 §12): scarce (max per day), never guilt,
 * wording rotates so it doesn't habituate, nothing on a fried day but what you asked for.
 */
import { isActive, rankTasks } from './planner';
import type { ID, ISODateTime, Task } from './model';
import type { AppState } from './reducer';

export interface PlannedNudge {
  /** Stable, so an unchanged plan schedules nothing new. */
  id: string;
  at: ISODateTime;
  title: string;
  body: string;
  taskId: ID;
  kind: 'intention' | 'resurface';
}

const DAY = 86_400_000;
/** Something "has sat a while" after two days untouched. */
export const RESURFACE_AFTER_DAYS = 2;
/** Resurfacing is planned for today and tomorrow; the plan is rebuilt every time the app opens. */
const RESURFACE_DAYS_AHEAD = 2;

export const TITLE_MAX = 60;
export const BODY_MAX = 110;

const INTENTION_TITLES = ["It's time.", 'This is the moment you picked.', 'You planned this for now.'];
const RESURFACE_TITLES = [
  (t: string) => `${t} is still here.`,
  (t: string) => `Still around: ${t}.`,
  (t: string) => `${t}, whenever you're ready.`,
];

export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Cheap stable hash, so the same nudge always gets the same wording and neighbours differ. */
function pick<T>(xs: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return xs[Math.abs(h) % xs.length];
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function sentence(s: string): string {
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function intentionNudge(t: Task): PlannedNudge {
  const at = (t.intention!.trigger as { at: ISODateTime }).at;
  const where = t.intention!.context ? ` ${t.intention!.context}` : '';
  return {
    id: `i:${t.id}:${at}`,
    at,
    title: clip(pick(INTENTION_TITLES, t.id + at), TITLE_MAX),
    body: clip(sentence(`${t.firstStep.text.replace(/[.!]+$/, '')}${where}`), BODY_MAX),
    taskId: t.id,
    kind: 'intention',
  };
}

function resurfaceNudge(t: Task, at: Date): PlannedNudge {
  const day = localDayKey(at);
  return {
    id: `r:${day}:${t.id}`,
    at: at.toISOString(),
    title: clip(pick(RESURFACE_TITLES, day)(t.title), TITLE_MAX),
    body: clip(`First step: ${lowerFirst(sentence(t.firstStep.text))}`, BODY_MAX),
    taskId: t.id,
    kind: 'resurface',
  };
}

/** Open tasks nobody has touched in a while, best first. Planned ones are already covered. */
export function resurfaceCandidates(state: AppState, now: number): Task[] {
  return rankTasks(state.tasks, undefined).filter(
    (t) => t.state === 'open' && !t.intention && now - Date.parse(t.updatedAt) >= RESURFACE_AFTER_DAYS * DAY,
  );
}

export function planNudges(state: AppState, at: ISODateTime): PlannedNudge[] {
  if (!state.nudges.enabled) return [];
  const now = Date.parse(at);

  // What the person asked for comes first and is never dropped for something we chose.
  const asked = state.tasks
    .filter((t) => isActive(t) && t.intention?.trigger.kind === 'time' && !t.intention.firedAt)
    .filter((t) => Date.parse((t.intention!.trigger as { at: ISODateTime }).at) > now)
    .map(intentionNudge);

  const ours: PlannedNudge[] = [];
  const daily = state.nudges.dailyAt?.match(/^(\d{2}):(\d{2})$/);
  if (daily) {
    const candidates = resurfaceCandidates(state, now);
    const today = new Date(now);
    for (let d = 0; d < RESURFACE_DAYS_AHEAD && candidates.length; d++) {
      const when = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d, Number(daily[1]), Number(daily[2]));
      if (when.getTime() <= now) continue;
      // Fried today means nothing extra today.
      if (d === 0 && state.energy === 'fried') continue;
      // A different task each day, so the same name doesn't nag twice running.
      ours.push(resurfaceNudge(candidates[d % candidates.length], when));
    }
  }

  const perDay = new Map<string, number>();
  const kept: PlannedNudge[] = [];
  for (const n of [...asked, ...ours]) {
    const day = localDayKey(new Date(n.at));
    const count = perDay.get(day) ?? 0;
    if (count >= state.nudges.maxPerDay) continue;
    perDay.set(day, count + 1);
    kept.push(n);
  }
  return kept.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
