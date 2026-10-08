/**
 * Picks the one task for the Now card. Energy fit first, deadline-free for now
 * (deadlines arrive with the next slice). See DayAllocation in the design model.
 */
import { isWaitingOnCue } from './intention';
import type { EnergyCost, EnergyLevel, ISODateTime, Task } from './model';
import type { AppState } from './state';

/** Lower is a better fit. Missing entries mean "don't put this on the Now card at this energy". */
const FIT: Record<EnergyLevel, Partial<Record<EnergyCost, number>>> = {
  high: { deep: 0, medium: 1, autopilot: 2 },
  medium: { medium: 0, autopilot: 1, deep: 2 },
  low: { autopilot: 0, medium: 1 },
  fried: { autopilot: 0 },
};

export function isActive(t: Task): boolean {
  return t.state === 'open' || t.state === 'started';
}

function fitRank(t: Task, energy: EnergyLevel | undefined): number | undefined {
  if (!energy) return 0;
  return FIT[energy][t.energy];
}

export function fitsEnergy(t: Task, energy: EnergyLevel | undefined): boolean {
  return fitRank(t, energy) !== undefined;
}

/**
 * Resting heavy tasks on low days is kind, but hiding the same task for weeks lets
 * avoidance win quietly. After this long out of sight, it comes back once, at its
 * smallest step. Never on a fried day.
 */
export const RESURFACE_HIDDEN_DAYS = 7;

export function longHidden(state: AppState, at: ISODateTime): Task[] {
  if (state.energy !== 'low') return [];
  const cutoff = Date.parse(at) - RESURFACE_HIDDEN_DAYS * 86_400_000;
  return state.tasks
    .filter((t) => isActive(t) && !fitsEnergy(t, state.energy) && !isWaitingOnCue(t) && !setAside(t, at))
    .filter((t) => Date.parse(t.lastSurfacedAt ?? t.createdAt) <= cutoff)
    .sort((a, b) => Date.parse(a.lastSurfacedAt ?? a.createdAt) - Date.parse(b.lastSurfacedAt ?? b.createdAt));
}

/** "Not now" or "stop here" means it: for a few hours that task goes behind everything else. */
export const SET_ASIDE_HOURS = 4;

function setAside(t: Task, at: ISODateTime | undefined): boolean {
  return !!at && !!t.lastDeferredAt && Date.parse(at) - Date.parse(t.lastDeferredAt) < SET_ASIDE_HOURS * 3_600_000;
}

/** Pass `at` to honour a recent "not now"; without it, only the order of deferrals counts. */
export function rankTasks(tasks: Task[], energy: EnergyLevel | undefined, at?: ISODateTime): Task[] {
  return tasks
    .filter(isActive)
    .filter((t) => fitRank(t, energy) !== undefined)
    .sort((a, b) =>
      (Number(setAside(a, at)) - Number(setAside(b, at))) ||
      (fitRank(a, energy)! - fitRank(b, energy)!) ||
      // Planned for a cue that hasn't happened: it waits for its moment.
      (Number(isWaitingOnCue(a)) - Number(isWaitingOnCue(b))) ||
      // Recently deferred goes to the back; never-deferred first.
      ((a.lastDeferredAt ? Date.parse(a.lastDeferredAt) : 0) - (b.lastDeferredAt ? Date.parse(b.lastDeferredAt) : 0)) ||
      // Momentum: something already started beats something new.
      (Number(b.state === 'started') - Number(a.state === 'started')) ||
      (Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    );
}

export interface NowPick {
  task?: Task;
  reason?: string;
  /** Active tasks hidden because they need more energy than the user has right now. */
  heldBack: number;
}

export function pickNow(state: AppState, at?: ISODateTime): NowPick {
  const active = state.tasks.filter(isActive);
  const ranked = rankTasks(state.tasks, state.energy, at);
  const pinned = state.pinnedNowId ? active.find((t) => t.id === state.pinnedNowId) : undefined;
  // A cue the person planned for just happened. That beats energy fit: they chose this moment.
  const fired = active
    .filter((t) => t.intention?.firedAt)
    .sort((a, b) => Date.parse(b.intention!.firedAt!) - Date.parse(a.intention!.firedAt!))[0];
  const resurfaced = at ? longHidden(state, at)[0] : undefined;
  const task = pinned ?? fired ?? resurfaced ?? ranked[0];
  const heldBack = active.filter((t) => t !== task && !ranked.includes(t)).length;
  if (!task) return { heldBack };
  let reason: string | undefined;
  if (pinned) reason = 'your pick';
  else if (task === fired) reason = 'you planned this';
  else if (task === resurfaced) reason = "it's been resting a while";
  else if (state.energy && fitRank(task, state.energy) === 0) reason = 'fits your energy';
  else if (task.state === 'started') reason = 'already started';
  return { task, reason, heldBack };
}
