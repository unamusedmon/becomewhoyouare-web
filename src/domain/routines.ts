/**
 * The routine and recurrence slice: spawning occurrences, the eternal-recurrence
 * triage question, and everything that follows from its answers.
 */
import type { Action } from './actions';
import type { AppState } from './state';
import { eventId, fireTimeCues, logEvent } from './events';
import { createTask, updateRoutine } from './tasks';
import { applyAnswer, completedToday, isRoutineDue, localDay, looserCadence, newRoutine } from './recurrence';
import type { RecurrenceVerdict } from './model';

export type RoutineAction = Extract<Action, {
  type:
    | 'add_routine' | 'tick' | 'restore_routine'
    | 'set_recurrence_enabled' | 'start_recurrence_session' | 'dismiss_recurrence_session'
    | 'set_recurrence_frequency' | 'answer_recurrence' | 'follow_up_recurrence'
    | 'reshape_routine' | 'link_routine_becoming';
}>;

export function isRoutineAction(a: Action): a is RoutineAction {
  switch (a.type) {
    case 'add_routine': case 'tick': case 'restore_routine':
    case 'set_recurrence_enabled': case 'start_recurrence_session': case 'dismiss_recurrence_session':
    case 'set_recurrence_frequency': case 'answer_recurrence': case 'follow_up_recurrence':
    case 'reshape_routine': case 'link_routine_becoming':
      return true;
    default:
      return false;
  }
}

export function routinesStep(state: AppState, action: RoutineAction): AppState {
  const { at } = action;
  switch (action.type) {
    case 'add_routine': {
      if (!action.title.trim()) return state;
      const routine = newRoutine(action.id, action.title, action.cadence, at);
      return routinesStep({ ...state, routines: [...state.routines, routine] }, { type: 'tick', at });
    }

    case 'tick': {
      const timed = fireTimeCues(state, at);
      if (timed !== state) return routinesStep(timed, action);
      const due = state.routines.filter((r) => isRoutineDue(r, state.tasks, at));
      if (!due.length) return state;
      const spawned = due.map((r) => ({
        ...createTask(`${r.id}@${localDay(at)}`, r.title, at, state.profile),
        routineId: r.id,
        becomingIds: r.becomingIds,
      }));
      const fresh = spawned.filter((t) => !state.tasks.some((x) => x.id === t.id));
      if (!fresh.length) return state;
      return {
        ...state,
        tasks: [...state.tasks, ...fresh],
        events: fresh.reduce((events, t) => [...events, { id: eventId(at), taskId: t.id, type: 'created' as const, at }], state.events),
      };
    }

    case 'restore_routine':
      return {
        ...state,
        routines: state.routines.map((r) => (r.id === action.routineId && r.status === 'released' ? { ...r, status: 'active', updatedAt: at } : r)),
      };

    case 'set_recurrence_enabled':
      return { ...state, recurrence: { ...state.recurrence, enabled: action.enabled, dismissStreak: 0 } };

    case 'start_recurrence_session':
      return {
        ...state,
        recurrence: {
          ...state.recurrence,
          lastSessionDay: localDay(at),
          lastSessionMoment: completedToday(state.events, at) ? 'win' : 'neutral',
        },
      };

    case 'dismiss_recurrence_session':
      return {
        ...state,
        recurrence: { ...state.recurrence, lastSessionDay: localDay(at), dismissStreak: state.recurrence.dismissStreak + 1 },
      };

    case 'set_recurrence_frequency': {
      const rec = { ...state.recurrence, askedAboutFrequency: true, dismissStreak: 0 };
      if (action.choice === 'less') rec.maxQuestionsPerSession = 1;
      if (action.choice === 'off') rec.enabled = false;
      return { ...state, recurrence: rec };
    }

    case 'answer_recurrence': {
      if (!state.routines.some((r) => r.id === action.routineId)) return state;
      const verdict: RecurrenceVerdict = {
        id: action.id, routineId: action.routineId, askedAt: at, answer: action.answer, energyNow: state.energy,
      };
      return {
        ...state,
        verdicts: [...state.verdicts, verdict],
        routines: updateRoutine(state, action.routineId, at, (r) => applyAnswer(r, action.answer, at)),
        recurrence: action.answer === 'skipped' ? state.recurrence : { ...state.recurrence, dismissStreak: 0 },
      };
    }

    case 'follow_up_recurrence': {
      const routine = state.routines.find((r) => r.id === action.routineId);
      if (!routine) return state;
      const lastIdx = state.verdicts.map((v) => v.routineId).lastIndexOf(routine.id);
      const verdicts = lastIdx < 0 ? state.verdicts : state.verdicts.map((v, i) => (i === lastIdx ? { ...v, followUp: action.followUp } : v));
      let routines = state.routines;
      let tasks = state.tasks;
      switch (action.followUp) {
        case 'make_rarer':
          routines = updateRoutine(state, routine.id, at, (r) => ({ ...r, cadence: looserCadence(r.cadence) }));
          break;
        case 'mark_toll_and_lighten':
          routines = updateRoutine(state, routine.id, at, (r) => ({ ...r, nature: 'toll' }));
          break;
        case 'reshape':
          routines = updateRoutine(state, routine.id, at, (r) => ({ ...r, recurrence: { ...r.recurrence, standing: 'reshaping' } }));
          break;
        case 'release':
          routines = updateRoutine(state, routine.id, at, (r) => ({ ...r, status: 'released' }));
          // Its open occurrence goes with it, quietly.
          tasks = state.tasks.map((t) =>
            t.routineId === routine.id && (t.state === 'open' || t.state === 'started') ? { ...t, state: 'released', updatedAt: at } : t);
          break;
        case 'later':
          // "Ask me again on a better day."
          routines = updateRoutine(state, routine.id, at, (r) => ({
            ...r, recurrence: { ...r.recurrence, nextEligibleAt: new Date(Date.parse(at) + 86_400_000).toISOString() },
          }));
          break;
        case 'keep_anyway':
          break;
      }
      return { ...state, verdicts, routines, tasks };
    }

    case 'reshape_routine': {
      const title = action.title.trim();
      if (!title) return state;
      return {
        ...state,
        routines: updateRoutine(state, action.routineId, at, (r) => ({ ...r, title, recurrence: { ...r.recurrence, standing: 'reshaping' } })),
        // The current occurrence takes the new shape too, with a fresh first step.
        tasks: state.tasks.map((t) =>
          t.routineId === action.routineId && t.state === 'open'
            ? { ...createTask(t.id, title, t.createdAt, state.profile), routineId: t.routineId, becomingIds: t.becomingIds, stats: t.stats, updatedAt: at }
            : t),
      };
    }

    case 'link_routine_becoming':
      return {
        ...state,
        routines: updateRoutine(state, action.routineId, at, (r) => ({
          ...r,
          becomingIds: action.becomingId ? [...new Set([...r.becomingIds, action.becomingId])] : r.becomingIds,
          recurrence: { ...r.recurrence, lastLinkPromptAt: at },
        })),
        tasks: action.becomingId
          ? state.tasks.map((t) =>
              t.routineId === action.routineId ? { ...t, becomingIds: [...new Set([...(t.becomingIds ?? []), action.becomingId!])] } : t)
          : state.tasks,
      };
  }
}
