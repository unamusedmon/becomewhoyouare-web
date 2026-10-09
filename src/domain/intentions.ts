/**
 * The implementation-intention slice: setting a when-where-how plan, clearing
 * it, and reporting "it's happening" when the planned cue occurs.
 */
import { cleanCue } from './intention';
import type { Action } from './actions';
import type { AppState } from './state';
import { logEvent } from './events';
import { updateTask } from './tasks';
import type { ImplementationIntention } from './model';

export type IntentionAction = Extract<Action, { type: 'set_intention' | 'clear_intention' | 'fire_intention' }>;

export function isIntentionAction(a: Action): a is IntentionAction {
  switch (a.type) {
    case 'set_intention': case 'clear_intention': case 'fire_intention':
      return true;
    default:
      return false;
  }
}

export function intentionsStep(state: AppState, action: IntentionAction): AppState {
  const { at } = action;
  switch (action.type) {
    case 'set_intention': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || !(task.state === 'open' || task.state === 'started')) return state;
      let trigger = action.trigger;
      if (trigger.kind === 'event') {
        const text = cleanCue(trigger.text);
        if (!text) return state;
        trigger = { kind: 'event', text };
      } else if (trigger.kind === 'time') {
        const when = Date.parse(trigger.at);
        // A time already gone isn't a plan.
        if (Number.isNaN(when) || when <= Date.parse(at)) return state;
        trigger = { kind: 'time', at: new Date(when).toISOString() };
      } else {
        const anchorId = trigger.taskId;
        const anchor = state.tasks.find((t) => t.id === anchorId);
        if (!anchor || anchor.id === task.id || !(anchor.state === 'open' || anchor.state === 'started')) return state;
      }
      const context = action.context?.trim() || undefined;
      const obstacle = action.ifObstacle?.obstacle.trim();
      const response = action.ifObstacle?.response.trim();
      const intention: ImplementationIntention = {
        trigger,
        context,
        ifObstacle: obstacle && response ? { obstacle, response } : undefined,
        setAt: at,
      };
      return {
        ...state,
        // A plan for later means "not on the Now card yet".
        pinnedNowId: state.pinnedNowId === task.id ? undefined : state.pinnedNowId,
        tasks: updateTask(state, task.id, at, (t) => ({ ...t, intention, openedAt: undefined })),
        events: logEvent(state, task.id, 'intention_set', at, { trigger: trigger.kind, where: !!context, obstacle: !!intention.ifObstacle }),
      };
    }

    case 'clear_intention':
      if (!state.tasks.some((t) => t.id === action.taskId && t.intention)) return state;
      return { ...state, tasks: updateTask(state, action.taskId, at, (t) => ({ ...t, intention: undefined })) };

    case 'fire_intention': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task?.intention || task.intention.firedAt) return state;
      return {
        ...state,
        tasks: updateTask(state, task.id, at, (t) => ({ ...t, intention: { ...t.intention!, firedAt: at } })),
        events: logEvent(state, task.id, 'intention_fired', at),
      };
    }
  }
}
