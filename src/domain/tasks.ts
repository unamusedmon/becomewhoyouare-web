/**
 * The task lifecycle slice: capture, surface, start, finish, set aside, let
 * go, bring back. Every handler is a pure (state, action) → state function;
 * the reducer dispatches here by action type.
 */
import { inferEnergy, categorize } from './classify';
import { defaultRawMinutes, estimateDuration, updateCalibration } from './duration';
import { settleIntention } from './intention';
import { generateFirstStep, nextAlternative, shrinkFirstStep, smallestFirstStep, validateFirstStep } from './firstStep';
import { longHidden } from './planner';
import { armFor, holdoutStep } from './experiment';
import type { Action } from './actions';
import type { AppState } from './state';
import { dropAfter, fireAfter, logEvent, waitingAfter, eventId } from './events';
import type { EnergyCost, ID, ISODateTime, Routine, Task, UserProfile } from './model';

export const SLIP_PROMPT_AFTER = 3;

export type TaskAction = Extract<Action, {
  type:
    | 'capture' | 'open' | 'backgrounded' | 'first_step_done' | 'complete' | 'not_now'
    | 'pause' | 'shrink' | 'next_alternative' | 'edit_step' | 'release' | 'keep_anyway'
    | 'pin_now' | 'set_energy' | 'rest' | 'restore' | 'rename';
}>;

export function isTaskAction(a: Action): a is TaskAction {
  switch (a.type) {
    case 'capture': case 'open': case 'backgrounded': case 'first_step_done': case 'complete':
    case 'not_now': case 'pause': case 'shrink': case 'next_alternative': case 'edit_step':
    case 'release': case 'keep_anyway': case 'pin_now': case 'set_energy': case 'rest':
    case 'restore': case 'rename':
      return true;
    default:
      return false;
  }
}

export function updateTask(state: AppState, taskId: ID, at: ISODateTime, fn: (t: Task) => Task): Task[] {
  return state.tasks.map((t) => (t.id === taskId ? { ...fn(t), updatedAt: at } : t));
}

export function updateRoutine(state: AppState, routineId: ID, at: ISODateTime, fn: (r: Routine) => Routine): Routine[] {
  return state.routines.map((r) => (r.id === routineId ? { ...fn(r), updatedAt: at } : r));
}

export function createTask(id: ID, title: string, at: ISODateTime, profile: UserProfile): Task {
  const clean = title.trim().replace(/\s+/g, ' ');
  const energy: EnergyCost = inferEnergy(clean);
  const raw = defaultRawMinutes(energy, categorize(clean));
  return {
    id,
    createdAt: at,
    updatedAt: at,
    title: clean,
    state: 'open',
    firstStep: generateFirstStep(clean, profile),
    energy,
    energySource: 'inferred',
    duration: estimateDuration(raw, profile.estimateCalibration[energy]),
    stats: { timesSurfaced: 0, timesSlipped: 0, timesShrunk: 0 },
    decayAfterDays: 21,
  };
}

export function tasksStep(state: AppState, action: TaskAction): AppState {
  const { at } = action;
  switch (action.type) {
    case 'capture': {
      if (!action.title.trim()) return state;
      const made = createTask(action.id, action.title, at, state.profile);
      const arm = state.experiments.firstStepTest ? armFor(action.id) : undefined;
      const task = arm === 'without_step' ? { ...made, firstStep: holdoutStep(made.title) } : made;
      const meta = action.via || arm ? { ...(action.via ? { via: action.via } : {}), ...(arm ? { arm } : {}) } : undefined;
      return { ...state, tasks: [...state.tasks, task], events: logEvent(state, task.id, 'created', at, meta) };
    }

    case 'open': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      // Only the first open counts: start latency runs from when the card first appeared.
      if (!task || task.openedAt) return state;
      // Back after a long rest on a low day: make it as small as it gets.
      const hidden = longHidden(state, at).some((t) => t.id === task.id);
      return {
        ...state,
        tasks: updateTask(state, task.id, at, (t) => ({
          ...t,
          openedAt: at,
          lastSurfacedAt: at,
          latencyInterrupted: undefined,
          firstStep: hidden ? smallestFirstStep(t.title, t.firstStep, state.profile) : t.firstStep,
          stats: { ...t.stats, timesSurfaced: t.stats.timesSurfaced + 1 },
        })),
        events: logEvent(state, task.id, 'opened', at),
      };
    }

    case 'backgrounded': {
      // Time spent away from the app is not hesitation; counting it would make the evidence lie.
      if (!state.tasks.some((t) => t.openedAt && !t.latencyInterrupted)) return state;
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.openedAt && !t.latencyInterrupted ? { ...t, latencyInterrupted: true } : t)),
      };
    }

    case 'first_step_done': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.firstStep.doneAt) return state;
      const latencySec = task.openedAt && !task.latencyInterrupted
        ? Math.max(0, Math.round((Date.parse(at) - Date.parse(task.openedAt)) / 1000))
        : undefined;
      return {
        ...state,
        tasks: updateTask(state, task.id, at, (t) => ({
          ...settleIntention(t),
          state: 'started',
          openedAt: undefined,
          latencyInterrupted: undefined,
          firstStep: { ...t.firstStep, doneAt: at },
          stats: {
            ...t.stats,
            firstStartedAt: t.stats.firstStartedAt ?? at,
            lastStartLatencySec: latencySec ?? t.stats.lastStartLatencySec,
          },
        })),
        events: logEvent(state, task.id, 'first_step_done', at, latencySec === undefined ? undefined : { latencySec }),
      };
    }

    case 'complete': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return state;
      // One unbroken sitting from first step to done is the only duration we can trust.
      const started = task.stats.firstStartedAt;
      const oneSitting = !!started && !(task.lastDeferredAt && Date.parse(task.lastDeferredAt) >= Date.parse(started));
      const profile = oneSitting
        ? {
            ...state.profile,
            estimateCalibration: {
              ...state.profile.estimateCalibration,
              [task.energy]: updateCalibration(
                state.profile.estimateCalibration[task.energy],
                task.duration.rawMinutes,
                (Date.parse(at) - Date.parse(started!)) / 60_000,
              ),
            },
          }
        : state.profile;
      return {
        ...state,
        profile,
        routines: task.routineId
          ? updateRoutine(state, task.routineId, at, (r) => ({ ...r, lastDoneAt: at }))
          : state.routines,
        pinnedNowId: state.pinnedNowId === action.taskId ? undefined : state.pinnedNowId,
        tasks: fireAfter(
          updateTask(state, action.taskId, at, (t) => ({ ...settleIntention(t), state: 'done', openedAt: undefined })),
          action.taskId,
          at,
        ),
        events: [
          ...logEvent(state, action.taskId, 'completed', at),
          ...waitingAfter(state.tasks, action.taskId).map((t) => ({ id: eventId(at), taskId: t.id, type: 'intention_fired' as const, at })),
        ],
      };
    }

    case 'not_now': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return state;
      const slipped = task.stats.timesSlipped + 1;
      return {
        ...state,
        pinnedNowId: state.pinnedNowId === task.id ? undefined : state.pinnedNowId,
        tasks: updateTask(state, task.id, at, (t) => ({
          ...settleIntention(t),
          openedAt: undefined,
          lastDeferredAt: at,
          slipPromptPending: slipped >= SLIP_PROMPT_AFTER && slipped % SLIP_PROMPT_AFTER === 0,
          stats: { ...t.stats, timesSlipped: slipped },
        })),
        events: logEvent(state, task.id, 'slipped', at),
      };
    }

    case 'pause': {
      if (!state.tasks.some((t) => t.id === action.taskId)) return state;
      return {
        ...state,
        pinnedNowId: state.pinnedNowId === action.taskId ? undefined : state.pinnedNowId,
        tasks: updateTask(state, action.taskId, at, (t) => ({ ...settleIntention(t), openedAt: undefined, lastDeferredAt: at })),
      };
    }

    case 'shrink': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return state;
      const smaller = shrinkFirstStep(task.title, task.firstStep, state.profile);
      return {
        ...state,
        tasks: updateTask(state, task.id, at, (t) => ({
          ...t,
          // Out of smaller steps: the slip question ("built wrong, not you") takes over.
          firstStep: smaller ?? t.firstStep,
          slipPromptPending: smaller ? t.slipPromptPending : true,
          stats: { ...t.stats, timesShrunk: t.stats.timesShrunk + 1 },
        })),
        events: logEvent(state, task.id, 'shrunk', at, { depth: smaller?.shrinkDepth ?? 'reshape' }),
      };
    }

    case 'next_alternative': {
      if (!state.tasks.some((t) => t.id === action.taskId)) return state;
      return {
        ...state,
        tasks: updateTask(state, action.taskId, at, (t) => ({ ...t, firstStep: nextAlternative(t.firstStep) })),
        events: logEvent(state, action.taskId, 'alternative_shown', at),
      };
    }

    case 'edit_step': {
      const text = action.text.trim();
      if (!text || !state.tasks.some((t) => t.id === action.taskId)) return state;
      // The user's own words always win; validation is only recorded, never enforced on them.
      const check = validateFirstStep(text);
      return {
        ...state,
        tasks: updateTask(state, action.taskId, at, (t) => ({
          ...t,
          firstStep: { ...t.firstStep, text, verb: text.split(/\s+/)[0].toLowerCase(), source: 'user' },
        })),
        events: logEvent(state, action.taskId, 'step_edited', at, { passesRules: check.ok }),
      };
    }

    case 'release': {
      if (!state.tasks.some((t) => t.id === action.taskId)) return state;
      return {
        ...state,
        pinnedNowId: state.pinnedNowId === action.taskId ? undefined : state.pinnedNowId,
        tasks: dropAfter(
          updateTask(state, action.taskId, at, (t) => ({ ...settleIntention(t), state: 'released', openedAt: undefined, slipPromptPending: false })),
          action.taskId,
        ),
        events: logEvent(state, action.taskId, 'released', at),
      };
    }

    case 'keep_anyway':
      return { ...state, tasks: updateTask(state, action.taskId, at, (t) => ({ ...t, slipPromptPending: false })) };

    case 'pin_now':
      return state.tasks.some((t) => t.id === action.taskId) ? { ...state, pinnedNowId: action.taskId } : state;

    case 'set_energy':
      return { ...state, energy: action.level };

    case 'rest':
      if (!state.tasks.some((t) => t.id === action.taskId)) return state;
      return {
        ...state,
        pinnedNowId: state.pinnedNowId === action.taskId ? undefined : state.pinnedNowId,
        tasks: dropAfter(
          updateTask(state, action.taskId, at, (t) => ({ ...settleIntention(t), state: 'resting', openedAt: undefined })),
          action.taskId,
        ),
      };

    case 'restore': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || (task.state !== 'resting' && task.state !== 'released')) return state;
      return {
        ...state,
        // A routine's own task stays tied to it; bringing it back revives the routine too.
        routines: task.routineId
          ? state.routines.map((r) => (r.id === task.routineId && r.status === 'released' ? { ...r, status: 'active', updatedAt: at } : r))
          : state.routines,
        tasks: updateTask(state, task.id, at, (t) => ({ ...t, state: 'open', openedAt: undefined, slipPromptPending: false })),
        events: logEvent(state, task.id, 'restored', at, { from: task.state }),
      };
    }

    case 'rename': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      const clean = action.title.trim().replace(/\s+/g, ' ');
      if (!task || !clean || clean === task.title) return state;
      const fresh = createTask(task.id, clean, at, state.profile);
      return {
        ...state,
        tasks: updateTask(state, task.id, at, (t) => ({
          ...t,
          title: clean,
          // A step they wrote stays theirs; a first-step-test task stays in its arm, under its new name.
          firstStep: t.firstStep.source === 'user' ? t.firstStep : t.firstStep.source === 'holdout' ? holdoutStep(clean) : fresh.firstStep,
          ...(t.energySource === 'inferred' ? { energy: fresh.energy, duration: fresh.duration } : {}),
        })),
        events: logEvent(state, task.id, 'renamed', at),
      };
    }
  }
}
