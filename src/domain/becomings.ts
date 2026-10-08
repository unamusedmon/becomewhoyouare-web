/**
 * The becoming slice: the long arc of who you are becoming, and which tasks
 * feed it. Up to three active becomings at a time.
 */
import type { Action } from './actions';
import type { AppState } from './state';
import { MAX_BECOMINGS } from './state';
import { updateTask } from './tasks';

export type BecomingAction = Extract<Action, {
  type: 'add_becoming' | 'edit_becoming' | 'outgrow_becoming' | 'link_task_becoming';
}>;

export function isBecomingAction(a: Action): a is BecomingAction {
  switch (a.type) {
    case 'add_becoming': case 'edit_becoming': case 'outgrow_becoming': case 'link_task_becoming':
      return true;
    default:
      return false;
  }
}

export function becomingsStep(state: AppState, action: BecomingAction): AppState {
  const { at } = action;
  switch (action.type) {
    case 'add_becoming': {
      const statement = action.statement.trim();
      const active = state.becomings.filter((b) => b.status === 'active');
      if (!statement || active.length >= MAX_BECOMINGS) return state;
      return { ...state, becomings: [...state.becomings, { id: action.id, createdAt: at, updatedAt: at, statement, status: 'active' }] };
    }

    case 'edit_becoming': {
      const statement = action.statement.trim();
      if (!statement) return state;
      return { ...state, becomings: state.becomings.map((b) => (b.id === action.id ? { ...b, statement, updatedAt: at } : b)) };
    }

    case 'outgrow_becoming':
      return { ...state, becomings: state.becomings.map((b) => (b.id === action.id ? { ...b, status: 'outgrown', updatedAt: at } : b)) };

    case 'link_task_becoming':
      return {
        ...state,
        tasks: updateTask(state, action.taskId, at, (t) => ({
          ...t,
          becomingIds: [...new Set([...(t.becomingIds ?? []), action.becomingId])],
        })),
      };
  }
}
