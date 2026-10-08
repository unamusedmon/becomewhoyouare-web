/**
 * Selbstüberwindung: evidence that you are becoming more capable, computed from what
 * actually happened. Shown only when the sample is big enough and the change is real.
 * Never fabricated encouragement. See OvercomingEvidence in docs/design/01-data-model.ts.
 */
import { categorize, type Category } from './classify';
import type { ISODateTime, Task, TaskEvent } from './model';

const DAY = 86_400_000;

/** Start latency: last two weeks against the eleven weeks before. */
export const RECENT_DAYS = 14;
export const BASELINE_DAYS = 90;
/** Medians of five swing on one odd day. Eight per side is still small, so the other guards matter too. */
export const MIN_SAMPLES = 8;
/** A drop must already have been there a few days ago too, so one lucky stretch can't produce it. */
export const PERSIST_DAYS = 3;
/** Recent median must be at most 3/4 of the baseline median, and at least a minute faster. */
export const MAX_RATIO = 0.75;
export const MIN_DROP_SEC = 60;

/** Category unlocked: last 30 days against the 30 before, with at least 60 days of history. */
export const UNLOCK_WINDOW_DAYS = 30;
export const UNLOCK_MIN_STARTS = 3;
/** The category must have been sitting there untouched, or "none before" means nothing. */
export const UNLOCK_MIN_WAITING = 2;

export interface Evidence {
  /** Stable per kind and group, so the Now screen can avoid repeating itself. */
  key: string;
  kind: 'start_latency_drop' | 'category_unlocked';
  headline: string;
  sampleSize: number;
  baseline: number;
  current: number;
}

const PHRASE: Partial<Record<Category | 'all', { start: string; noun: string }>> = {
  all: { start: 'things', noun: 'things' },
  write: { start: 'writing', noun: 'writing tasks' },
  email: { start: 'emails', noun: 'emails' },
  call: { start: 'calls', noun: 'calls' },
  appointment: { start: 'booking things', noun: 'bookings' },
  admin: { start: 'admin', noun: 'admin tasks' },
  clean: { start: 'cleaning', noun: 'cleaning tasks' },
  shop: { start: 'errands', noun: 'errands' },
  exercise: { start: 'moving', noun: 'workouts' },
  read: { start: 'reading', noun: 'reading sessions' },
};

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Felt, rounded durations: "about 40 minutes", never "38.5 minutes". */
export function aboutDuration(sec: number): string {
  if (sec < 60) return 'under a minute';
  const min = Math.round(sec / 60);
  if (min < 90) return `about ${min} ${min === 1 ? 'minute' : 'minutes'}`;
  const h = Math.round(sec / 3600);
  if (h < 36) return `about ${h} hours`;
  const d = Math.round(sec / 86_400);
  return `about ${d} days`;
}

interface Start { at: number; latencySec: number; category: Category }

/** Shown, never started, then let go. If these rise, a falling median may only mean the hard ones left. */
interface Dropout { at: number; category: Category }

function starts(events: TaskEvent[], tasks: Task[]): Start[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Start[] = [];
  for (const e of events) {
    if (e.type !== 'first_step_done') continue;
    const latencySec = e.meta?.latencySec;
    const task = byId.get(e.taskId);
    if (typeof latencySec !== 'number' || !task) continue;
    out.push({ at: Date.parse(e.at), latencySec, category: categorize(task.title) });
  }
  return out;
}

function dropouts(events: TaskEvent[], tasks: Task[]): Dropout[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const shown = new Set<string>();
  const started = new Set<string>();
  const out: Dropout[] = [];
  for (const e of events) {
    if (e.type === 'opened') shown.add(e.taskId);
    if (e.type === 'first_step_done') started.add(e.taskId);
    const task = byId.get(e.taskId);
    if (e.type === 'released' && task && shown.has(e.taskId) && !started.has(e.taskId)) {
      out.push({ at: Date.parse(e.at), category: categorize(task.title) });
    }
  }
  return out;
}

interface Drop { group: Category | 'all'; baseline: number; current: number; samples: number }

function latencyDrops(all: Start[], gone: Dropout[], now: number): Drop[] {
  const recentFrom = now - RECENT_DAYS * DAY;
  const baselineFrom = now - BASELINE_DAYS * DAY;
  const inRecent = (at: number) => at > recentFrom && at <= now;
  const inBaseline = (at: number) => at > baselineFrom && at <= recentFrom;
  const out: Drop[] = [];
  for (const g of Object.keys(PHRASE) as (Category | 'all')[]) {
    const mine = g === 'all' ? all : all.filter((s) => s.category === g);
    const recent = mine.filter((s) => inRecent(s.at)).map((s) => s.latencySec);
    const baseline = mine.filter((s) => inBaseline(s.at)).map((s) => s.latencySec);
    if (recent.length < MIN_SAMPLES || baseline.length < MIN_SAMPLES) continue;
    const b = median(baseline);
    const c = median(recent);
    if (c > b * MAX_RATIO || b - c < MIN_DROP_SEC) continue;
    // Same rounded words on both sides isn't a change a person would recognize.
    if (aboutDuration(b) === aboutDuration(c)) continue;
    // Survivorship: if more shown tasks were dropped unstarted lately, the faster median may be selection, not change.
    const mineGone = g === 'all' ? gone : gone.filter((d) => d.category === g);
    const share = (dropped: number, startedN: number) => dropped / (dropped + startedN);
    if (share(mineGone.filter((d) => inRecent(d.at)).length, recent.length) >
        share(mineGone.filter((d) => inBaseline(d.at)).length, baseline.length)) continue;
    out.push({ group: g, baseline: b, current: c, samples: recent.length + baseline.length });
  }
  return out;
}

function latencyEvidence(all: Start[], gone: Dropout[], now: number): Evidence[] {
  const earlier = new Set(latencyDrops(all, gone, now - PERSIST_DAYS * DAY).map((d) => d.group));
  const out: Evidence[] = [];
  for (const { group: g, baseline: b, current: c, samples } of latencyDrops(all, gone, now)) {
    if (!earlier.has(g)) continue;
    out.push({
      key: `start_latency_drop:${g}`,
      kind: 'start_latency_drop',
      headline: `It used to take you ${aboutDuration(b)} to start ${PHRASE[g]!.start}. These last two weeks: ${aboutDuration(c)}.`,
      sampleSize: samples,
      baseline: b,
      current: c,
    });
  }
  return out;
}

function unlockedEvidence(tasks: Task[], events: TaskEvent[], now: number): Evidence[] {
  const earliest = Math.min(...events.map((e) => Date.parse(e.at)));
  if (!(now - earliest >= 2 * UNLOCK_WINDOW_DAYS * DAY)) return [];
  const recentFrom = now - UNLOCK_WINDOW_DAYS * DAY;
  const priorFrom = now - 2 * UNLOCK_WINDOW_DAYS * DAY;
  // Any start counts here, with or without a measured latency.
  const firstStart = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'first_step_done' && !firstStart.has(e.taskId)) firstStart.set(e.taskId, Date.parse(e.at));
  }
  const out: Evidence[] = [];
  for (const g of Object.keys(PHRASE) as (Category | 'all')[]) {
    if (g === 'all') continue;
    const mine = tasks.filter((t) => categorize(t.title) === g);
    const startedIn = (from: number, to: number) =>
      mine.filter((t) => { const at = firstStart.get(t.id); return at !== undefined && at > from && at <= to; }).length;
    const recent = startedIn(recentFrom, now);
    const prior = startedIn(priorFrom, recentFrom);
    const waiting = mine.filter((t) => {
      const at = firstStart.get(t.id);
      return Date.parse(t.createdAt) <= recentFrom && (at === undefined || at > recentFrom);
    }).length;
    if (recent < UNLOCK_MIN_STARTS || prior > 0 || waiting < UNLOCK_MIN_WAITING) continue;
    out.push({
      key: `category_unlocked:${g}`,
      kind: 'category_unlocked',
      headline: `You started ${recent} ${PHRASE[g]!.noun} in the last month. The month before: none.`,
      sampleSize: recent,
      baseline: prior,
      current: recent,
    });
  }
  return out;
}

/** Strongest first. Empty is the honest, common answer for the first weeks. */
export function computeEvidence(tasks: Task[], events: TaskEvent[], at: ISODateTime): Evidence[] {
  if (!events.length) return [];
  const now = Date.parse(at);
  const all = starts(events, tasks);
  let latency = latencyEvidence(all, dropouts(events, tasks), now);
  // When one kind of task is the whole story, "things" just repeats it in vaguer words.
  const same = (a: Evidence, b: Evidence) =>
    aboutDuration(a.baseline) === aboutDuration(b.baseline) && aboutDuration(a.current) === aboutDuration(b.current);
  const overall = latency.find((e) => e.key === 'start_latency_drop:all');
  if (overall && latency.some((e) => e !== overall && same(e, overall))) latency = latency.filter((e) => e !== overall);
  latency.sort((a, b) => a.current / a.baseline - b.current / b.baseline);
  return [...latency, ...unlockedEvidence(tasks, events, now)];
}

export const RESHOW_AFTER_DAYS = 14;
/** Praise that arrives every visit stops meaning anything, so any card buys a few quiet days. */
export const MIN_GAP_DAYS = 3;

/** The one piece of evidence worth interrupting the Now screen for, if any. */
export function evidenceToShow(evidence: Evidence[], lastShownAt: Record<string, ISODateTime>, at: ISODateTime): Evidence | undefined {
  const now = Date.parse(at);
  if (Object.values(lastShownAt).some((t) => now - Date.parse(t) < MIN_GAP_DAYS * DAY)) return undefined;
  return evidence.find((e) => {
    const shown = lastShownAt[e.key];
    return !shown || now - Date.parse(shown) >= RESHOW_AFTER_DAYS * DAY;
  });
}
