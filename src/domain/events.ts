/**
 * The event log and the cue mechanics that write to it: firing time cues,
 * firing "after task" plans, and dropping plans whose anchor went away.
 * Pure functions; slices call them while handling an action.
 */
import type { ID, ISODateTime, Task, TaskEvent, TaskEventType } from './model';
import type { AppState } from './state';

let eventSeq = 0;
/** Differs per app run, so two synced devices can't mint the same event id in the same millisecond. */
const RUN_TAG = Math.random().toString(36).slice(2, 6);
export function eventId(at: ISODateTime): ID {
  eventSeq = (eventSeq + 1) % 1_000_000;
  return `${Date.parse(at).toString(36)}-${eventSeq.toString(36)}-${RUN_TAG}`;
}

export function logEvent(
  state: AppState, taskId: ID, type: TaskEventType, at: ISODateTime, meta?: Record<string, unknown>,
): TaskEvent[] {
  return [...state.events, { id: eventId(at), taskId, type, at, energyNow: state.energy, meta }];
}

/** Clock-time cues whose moment has come, fired in one go. Same state back when there are none. */
export function fireTimeCues(state: AppState, at: ISODateTime): AppState {
  const now = Date.parse(at);
  const due = state.tasks.filter(
    (t) => (t.state === 'open' || t.state === 'started') && t.intention?.trigger.kind === 'time' &&
      !t.intention.firedAt && Date.parse(t.intention.trigger.at) <= now,
  );
  if (!due.length) return state;
  const ids = new Set(due.map((t) => t.id));
  return {
    ...state,
    tasks: state.tasks.map((t) => (ids.has(t.id) ? { ...t, updatedAt: at, intention: { ...t.intention!, firedAt: at } } : t)),
    events: [...state.events, ...due.map((t) => ({ id: eventId(at), taskId: t.id, type: 'intention_fired' as const, at }))],
  };
}

/** Active tasks planned for "after {anchorId}" whose cue hasn't fired yet. */
export function waitingAfter(tasks: Task[], anchorId: ID): Task[] {
  return tasks.filter(
    (t) => (t.state === 'open' || t.state === 'started') &&
      t.intention?.trigger.kind === 'after_task' && t.intention.trigger.taskId === anchorId && !t.intention.firedAt,
  );
}

export function fireAfter(tasks: Task[], anchorId: ID, at: ISODateTime): Task[] {
  const ids = new Set(waitingAfter(tasks, anchorId).map((t) => t.id));
  return tasks.map((t) => (ids.has(t.id) ? { ...t, updatedAt: at, intention: { ...t.intention!, firedAt: at } } : t));
}

/** The anchor went away without being done, so "after it" means nothing now. The task stays; the plan goes. */
export function dropAfter(tasks: Task[], anchorId: ID): Task[] {
  return tasks.map((t) =>
    t.intention?.trigger.kind === 'after_task' && t.intention.trigger.taskId === anchorId ? { ...t, intention: undefined } : t);
}
