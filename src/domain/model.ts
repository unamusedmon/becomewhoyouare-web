/**
 * The slice of the data model this first build implements.
 * Full design reference: docs/design/01-data-model.ts. Names and shapes match it,
 * so later slices extend these types rather than replace them.
 */

export type ID = string;
export type ISODateTime = string;
export type Minutes = number;

export type EnergyCost = 'deep' | 'medium' | 'autopilot';
export type EnergyLevel = 'high' | 'medium' | 'low' | 'fried';

export type TaskState = 'open' | 'started' | 'done' | 'resting' | 'released';

export type DurationUnitId =
  | 'song' | 'episode_sitcom' | 'podcast' | 'episode_drama' | 'laundry_wash' | 'movie';

export interface DurationUnit {
  id: DurationUnitId;
  singular: string; // "song"
  plural: string;   // "songs"
  minutes: Minutes;
}

export interface DurationEstimate {
  rawMinutes: Minutes;
  plannedMinutes: Minutes;
  experiential: { unitId: DurationUnitId; count: number; label: string };
  confidence: 'guess' | 'learned';
}

export interface FirstStep {
  text: string;
  verb: string;
  object?: string;
  estSeconds: number;
  /** 'holdout': the first-step test's "without" arm, which shows only the task. */
  source: 'generated' | 'user' | 'template' | 'holdout';
  shrinkDepth: number;
  alternatives?: string[];
  doneAt?: ISODateTime;
}

export interface TaskStats {
  timesSurfaced: number;
  timesSlipped: number; // in this slice: times the user tapped "not now"
  timesShrunk: number;
  firstStartedAt?: ISODateTime;
  lastStartLatencySec?: number;
}

export interface Task {
  id: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  title: string;
  state: TaskState;
  firstStep: FirstStep;
  energy: EnergyCost;
  energySource: 'inferred' | 'user';
  duration: DurationEstimate;
  stats: TaskStats;
  /** When the task card was last put in front of the user; start latency is measured from here. */
  openedAt?: ISODateTime;
  /**
   * The app left the foreground while the clock was running, so the gap no longer
   * measures hesitation. That start is logged without a latency.
   */
  latencyInterrupted?: boolean;
  /** Last time the task was put in front of the user at all. Long-hidden tasks come back once. */
  lastSurfacedAt?: ISODateTime;
  /** Last "not now"; the planner puts recently deferred tasks behind the others. */
  lastDeferredAt?: ISODateTime;
  /** True while the slip question is waiting for an answer. */
  slipPromptPending?: boolean;
  decayAfterDays: number;
  /** Set when this task is one occurrence of a routine. */
  routineId?: ID;
  becomingIds?: ID[];
  intention?: ImplementationIntention;
}

export type TaskEventType =
  | 'created' | 'opened' | 'first_step_done' | 'completed'
  | 'slipped' | 'shrunk' | 'released' | 'alternative_shown' | 'step_edited'
  | 'intention_set' | 'intention_fired' | 'restored' | 'renamed';

export interface TaskEvent {
  id: ID;
  taskId: ID;
  type: TaskEventType;
  at: ISODateTime;
  energyNow?: EnergyLevel;
  meta?: Record<string, unknown>;
}

export interface UserProfile {
  knownTools: { mail?: string; docs?: string; calendar?: string };
  /** Starts at 1.5: generous buffers by default (planning fallacy). */
  estimateCalibration: Record<EnergyCost, number>;
}

// ─── Slice 2: becoming, routines, eternal recurrence ─────────────────────────

/** An identity-in-progress, not a goal: "someone who writes every week". Up to 3 at a time. */
export interface Becoming {
  id: ID;
  createdAt: ISODateTime;
  /** Missing on becomings saved before sync existed; createdAt stands in. */
  updatedAt?: ISODateTime;
  statement: string;
  status: 'active' | 'resting' | 'outgrown';
}

export type LooseCadence = 'daily' | 'few_per_week' | 'weekly' | 'monthly';

export type RecurrenceStanding = 'affirmed' | 'questioned' | 'reshaping' | 'unasked';

export interface Routine {
  id: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  title: string;
  cadence: LooseCadence;
  /** Tolls (taxes, school pickup) get "how can this weigh less?" instead of "should this exist?". */
  nature: 'chosen' | 'toll' | 'unknown';
  becomingIds: ID[];
  lastDoneAt?: ISODateTime;
  status: 'active' | 'paused' | 'released';
  recurrence: {
    lastAskedAt?: ISODateTime;
    nextEligibleAt: ISODateTime;
    consecutiveYes: number;
    standing: RecurrenceStanding;
    lastLinkPromptAt?: ISODateTime;
  };
}

export type RecurrenceAnswer = 'yes' | 'no' | 'unsure' | 'skipped';
export type RecurrenceFollowUp =
  | 'reshape' | 'make_rarer' | 'mark_toll_and_lighten' | 'release' | 'keep_anyway' | 'later';

export interface RecurrenceVerdict {
  id: ID;
  routineId: ID;
  askedAt: ISODateTime;
  answer: RecurrenceAnswer;
  followUp?: RecurrenceFollowUp;
  energyNow?: EnergyLevel;
}

export interface RecurrenceSettings {
  enabled: boolean;
  maxQuestionsPerSession: number;
  /** Local date ("2026-10-07") of the last session, so it runs at most once a day. */
  lastSessionDay?: string;
  /**
   * Where the last session happened. A good mood after a win tilts answers toward "yes"
   * (mood as information), so sessions alternate between a win and a neutral moment.
   */
  lastSessionMoment?: 'win' | 'neutral';
  /** Sessions dismissed in a row. At 3 the app asks once whether to ask less. */
  dismissStreak: number;
  askedAboutFrequency: boolean;
}

export interface OnboardingState {
  completedAt?: ISODateTime;
}

// ─── Slice 4: implementation intentions, overcoming evidence ─────────────────

/** WHEN. Event cues are preferred; clock times work too, via a notification. Place waits. */
export type IntentionTrigger =
  | { kind: 'event'; text: string }     // "I finish my coffee" (habit-stacked)
  | { kind: 'after_task'; taskId: ID }  // "after I send the invoice"
  | { kind: 'time'; at: ISODateTime };  // "tomorrow at 9". Allowed, never the only support.

/**
 * Gollwitzer's when-where-how. HOW is always the task's current first step, so the
 * sentence is rendered, not stored: it stays true when the step is shrunk or edited.
 */
export interface ImplementationIntention {
  trigger: IntentionTrigger;
  context?: string;                                    // WHERE: "at my desk"
  ifObstacle?: { obstacle: string; response: string }; // MCII: "If I open Twitter, then I close it and type one bullet."
  setAt: ISODateTime;
  /** The cue happened. The task goes to the front until it is started or set aside. */
  firedAt?: ISODateTime;
}

export interface OvercomingSettings {
  /** Evidence key → when it was last shown on the Now screen. Each shows at most once a fortnight. */
  lastShownAt: Record<string, ISODateTime>;
}

// ─── Slice 5: nudges ─────────────────────────────────────────────────────────

/** Notifications are a scarce resource: identical, frequent prompts stop working fast. */
export interface NudgeSettings {
  /** Off until the person turns it on and Android grants permission. */
  enabled: boolean;
  maxPerDay: number;
  /** Local "HH:MM" for one daily nudge about something that has sat a while. Unset = none. */
  dailyAt?: string;
}
