/**
 * All state changes, as one pure reducer. The real work lives in slices
 * (tasks, routines, intentions, becomings, settings); this file routes,
 * stamps `changedAt`, and marks hints as used. The old single-file exports
 * (initialState, migrate, createTask, MAX_BECOMINGS, SLIP_PROMPT_AFTER,
 * AppState, Action) are re-exported so nothing else has to change.
 */
import { markSeen, type HintId } from './hints';
import { mergeStates } from './sync';
import type { Action } from './actions';
import type { AppState } from './state';
import { isTaskAction, tasksStep, type TaskAction } from './tasks';
import { isRoutineAction, routinesStep, type RoutineAction } from './routines';
import { isIntentionAction, intentionsStep, type IntentionAction } from './intentions';
import { isBecomingAction, becomingsStep, type BecomingAction } from './becomings';
import { isSettingsAction, settingsStep, type SettingsAction } from './settings';

export { initialState, migrate, MAX_BECOMINGS } from './state';
export { createTask, SLIP_PROMPT_AFTER } from './tasks';
export type { Action } from './actions';
export type { AppState } from './state';

/** If an action type is added without a slice to own it, this line fails to compile. */
type Handled = TaskAction | RoutineAction | IntentionAction | BecomingAction | SettingsAction | Extract<Action, { type: 'sync_merge' }>;
type _EveryActionHasAHome = [Handled] extends [Action] ? ([Action] extends [Handled] ? true : never) : never;
const _routeIsExhaustive: _EveryActionHasAHome = true;

/** Using a feature is the best sign its hint isn't needed. */
const HINT_USED: Partial<Record<Action['type'], HintId>> = {
  set_energy: 'energy',
  rename: 'rename',
  pin_now: 'also_here',
  set_intention: 'plan',
  restore: 'set_aside',
  restore_routine: 'set_aside',
};

export function reducer(state: AppState, action: Action): AppState {
  if (action.type === 'sync_merge') return mergeStates(state, action.remote);
  const next = step(state, action);
  if (next === state) return state;
  const used = action.type === 'capture' && action.via === 'voice' ? 'mic' : HINT_USED[action.type];
  const stamped = { ...next, changedAt: action.at };
  return used ? { ...stamped, hints: markSeen(stamped.hints, used, action.at) } : stamped;
}

/** sync_merge is handled before dispatching to a domain slice. */
type SliceAction = Exclude<Action, { type: 'sync_merge' }>;

function step(state: AppState, action: SliceAction): AppState {
  if (isTaskAction(action)) return tasksStep(state, action);
  if (isRoutineAction(action)) return routinesStep(state, action);
  if (isIntentionAction(action)) return intentionsStep(state, action);
  if (isBecomingAction(action)) return becomingsStep(state, action);
  return settingsStep(state, action);
}
