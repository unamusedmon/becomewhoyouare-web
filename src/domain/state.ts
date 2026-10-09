/**
 * The app's saved state: its shape, its starting point, and how older saves
 * come forward. Kept apart from the reducer so pure selectors (planner,
 * nudges, org export) can depend on the shape without dragging in behavior.
 */
import { initialHints, type HintSettings } from './hints';
import type {
  Becoming, EnergyLevel, ID, ISODateTime, NudgeSettings, OnboardingState,
  OvercomingSettings, RecurrenceSettings, RecurrenceVerdict, Routine, Task, TaskEvent, UserProfile,
} from './model';

export interface AppState {
  version: 1;
  tasks: Task[];
  events: TaskEvent[];
  energy?: EnergyLevel;
  /** The task the user explicitly pulled onto the Now card, if any. */
  pinnedNowId?: ID;
  profile: UserProfile;
  becomings: Becoming[];
  routines: Routine[];
  verdicts: RecurrenceVerdict[];
  recurrence: RecurrenceSettings;
  onboarding: OnboardingState;
  overcoming: OvercomingSettings;
  nudges: NudgeSettings;
  hints: HintSettings;
  /** Self-experiments the person opted into. */
  experiments: { firstStepTest: boolean };
  /** Last time anything changed. When two devices disagree on a setting, the later one wins. */
  changedAt?: ISODateTime;
}

export const MAX_BECOMINGS = 3;

export const initialState: AppState = {
  version: 1,
  tasks: [],
  events: [],
  profile: {
    knownTools: {},
    estimateCalibration: { deep: 1.5, medium: 1.5, autopilot: 1.5 },
  },
  becomings: [],
  routines: [],
  verdicts: [],
  // Off until the person opts in. Never a daily ritual by default.
  recurrence: { enabled: false, maxQuestionsPerSession: 3, dismissStreak: 0, askedAboutFrequency: false },
  onboarding: {},
  overcoming: { lastShownAt: {} },
  // Off until asked for. Six a day at most (docs/design/05, §12).
  nudges: { enabled: false, maxPerDay: 6 },
  hints: initialHints,
  experiments: { firstStepTest: false },
};

/** Fills fields added after a state was saved, so older saves keep working. */
export function migrate(saved: Partial<AppState> & { version: 1 }): AppState {
  return {
    ...initialState,
    ...saved,
    profile: { ...initialState.profile, ...saved.profile },
    recurrence: { ...initialState.recurrence, ...saved.recurrence },
    onboarding: { ...initialState.onboarding, ...saved.onboarding },
    overcoming: { ...initialState.overcoming, ...saved.overcoming },
    nudges: { ...initialState.nudges, ...saved.nudges },
    hints: { ...initialState.hints, ...saved.hints, seen: { ...saved.hints?.seen } },
    experiments: { ...initialState.experiments, ...saved.experiments },
  };
}
