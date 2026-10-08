/**
 * Everything the app can do, as one discriminated union. Every action carries
 * its own timestamp so state changes stay deterministic and testable.
 * Kept apart from the reducer (and the state) so slices can narrow to the
 * actions they own without importing each other.
 */
import type {
  EnergyLevel, ID, IntentionTrigger, ISODateTime,
  LooseCadence, NudgeSettings, RecurrenceAnswer, RecurrenceFollowUp,
} from './model';
import type { HintId } from './hints';
import type { AppState } from './state';

export type Action =
  | { type: 'capture'; at: ISODateTime; id: ID; title: string; via?: 'voice' }
  | { type: 'open'; at: ISODateTime; taskId: ID }
  /** The app went to the background: any start-latency clock that is running stops meaning anything. */
  | { type: 'backgrounded'; at: ISODateTime }
  | { type: 'first_step_done'; at: ISODateTime; taskId: ID }
  | { type: 'complete'; at: ISODateTime; taskId: ID }
  | { type: 'not_now'; at: ISODateTime; taskId: ID }
  /** "That counts. Stop here." Steps aside without counting as a slip. */
  | { type: 'pause'; at: ISODateTime; taskId: ID }
  | { type: 'shrink'; at: ISODateTime; taskId: ID }
  | { type: 'next_alternative'; at: ISODateTime; taskId: ID }
  | { type: 'edit_step'; at: ISODateTime; taskId: ID; text: string }
  | { type: 'release'; at: ISODateTime; taskId: ID }
  | { type: 'keep_anyway'; at: ISODateTime; taskId: ID }
  | { type: 'pin_now'; at: ISODateTime; taskId: ID }
  | { type: 'set_energy'; at: ISODateTime; level: EnergyLevel | undefined }
  /** Onboarding's "not now": out of sight, fully retrievable. */
  | { type: 'rest'; at: ISODateTime; taskId: ID }
  /** Brings a set-aside or let-go task back to the list. */
  | { type: 'restore'; at: ISODateTime; taskId: ID }
  | { type: 'restore_routine'; at: ISODateTime; routineId: ID }
  /** Fixes a title (a typo, a misheard word). A first step the person wrote themselves is kept. */
  | { type: 'rename'; at: ISODateTime; taskId: ID; title: string }
  | { type: 'complete_onboarding'; at: ISODateTime }
  | { type: 'add_becoming'; at: ISODateTime; id: ID; statement: string }
  | { type: 'edit_becoming'; at: ISODateTime; id: ID; statement: string }
  | { type: 'outgrow_becoming'; at: ISODateTime; id: ID }
  | { type: 'link_task_becoming'; at: ISODateTime; taskId: ID; becomingId: ID }
  | { type: 'add_routine'; at: ISODateTime; id: ID; title: string; cadence: LooseCadence }
  /** Spawns tasks for routines that are due. Ids are derived, so ticking twice is harmless. */
  | { type: 'tick'; at: ISODateTime }
  | { type: 'set_recurrence_enabled'; at: ISODateTime; enabled: boolean }
  | { type: 'start_recurrence_session'; at: ISODateTime }
  | { type: 'dismiss_recurrence_session'; at: ISODateTime }
  | { type: 'set_recurrence_frequency'; at: ISODateTime; choice: 'same' | 'less' | 'off' }
  | { type: 'answer_recurrence'; at: ISODateTime; id: ID; routineId: ID; answer: RecurrenceAnswer }
  | { type: 'follow_up_recurrence'; at: ISODateTime; routineId: ID; followUp: RecurrenceFollowUp }
  | { type: 'reshape_routine'; at: ISODateTime; routineId: ID; title: string }
  /** becomingId null = "skip"; it still records that we asked. */
  | { type: 'link_routine_becoming'; at: ISODateTime; routineId: ID; becomingId: ID | null }
  | {
      type: 'set_intention'; at: ISODateTime; taskId: ID; trigger: IntentionTrigger;
      context?: string; ifObstacle?: { obstacle: string; response: string };
    }
  | { type: 'clear_intention'; at: ISODateTime; taskId: ID }
  /** "It's happening": the cue the person planned around just occurred. */
  | { type: 'fire_intention'; at: ISODateTime; taskId: ID }
  | { type: 'evidence_shown'; at: ISODateTime; key: string }
  | { type: 'set_nudges'; at: ISODateTime; patch: Partial<NudgeSettings> }
  /** Dismissed, or the person just used the thing it explains. */
  | { type: 'hint_seen'; at: ISODateTime; id: HintId }
  | { type: 'set_hints'; at: ISODateTime; enabled: boolean }
  /** "Show hints again": forget which ones were seen. */
  | { type: 'reset_hints'; at: ISODateTime }
  | { type: 'set_first_step_test'; at: ISODateTime; enabled: boolean }
  /** Another device's state, merged in (see sync.ts). */
  | { type: 'sync_merge'; at: ISODateTime; remote: AppState };
