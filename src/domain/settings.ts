/**
 * The settings slice: onboarding, hints, nudges, self-experiments, and the
 * "evidence shown" bookkeeping. Nothing here touches a task's substance.
 */
import { markSeen } from './hints';
import type { Action } from './actions';
import type { AppState } from './state';

export type SettingsAction = Extract<Action, {
  type:
    | 'complete_onboarding' | 'evidence_shown' | 'set_nudges'
    | 'hint_seen' | 'set_hints' | 'reset_hints' | 'set_first_step_test';
}>;

export function isSettingsAction(a: Action): a is SettingsAction {
  switch (a.type) {
    case 'complete_onboarding': case 'evidence_shown': case 'set_nudges':
    case 'hint_seen': case 'set_hints': case 'reset_hints': case 'set_first_step_test':
      return true;
    default:
      return false;
  }
}

export function settingsStep(state: AppState, action: SettingsAction): AppState {
  const { at } = action;
  switch (action.type) {
    case 'complete_onboarding':
      return { ...state, onboarding: { ...state.onboarding, completedAt: state.onboarding.completedAt ?? at } };

    case 'evidence_shown':
      return { ...state, overcoming: { ...state.overcoming, lastShownAt: { ...state.overcoming.lastShownAt, [action.key]: at } } };

    case 'hint_seen': {
      const hints = markSeen(state.hints, action.id, at);
      return hints === state.hints ? state : { ...state, hints };
    }

    case 'set_hints':
      return { ...state, hints: { ...state.hints, enabled: action.enabled } };

    case 'reset_hints':
      return { ...state, hints: { enabled: true, seen: {} } };

    case 'set_first_step_test':
      return { ...state, experiments: { ...state.experiments, firstStepTest: action.enabled } };

    case 'set_nudges': {
      const patch = { ...action.patch };
      if ('dailyAt' in patch && patch.dailyAt !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.dailyAt)) delete patch.dailyAt;
      return { ...state, nudges: { ...state.nudges, ...patch } };
    }
  }
}
