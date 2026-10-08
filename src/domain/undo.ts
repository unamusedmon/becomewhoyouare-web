/**
 * One step of undo for the taps that are easy to hit by accident and hard to
 * see the consequence of. Mistaps are common with ADHD, and fear of an
 * irreversible tap is a reason to avoid an app. Kept in memory only.
 */
import type { ISODateTime } from './model';
import type { Action, AppState } from './reducer';

export interface UndoSlot {
  label: string;
  at: ISODateTime;
  before: AppState;
}

/** How long the Undo bar stays up. Long enough to notice, short enough not to linger. */
export const UNDO_MS = 7000;

const LABELS: Partial<Record<Action['type'], string>> = {
  complete: 'Marked done.',
  release: 'Let go.',
  not_now: 'Moved to later.',
  first_step_done: 'Marked as started.',
  pause: 'Stopped here.',
  rest: 'Set aside.',
  rename: 'Renamed.',
  clear_intention: 'Plan removed.',
  outgrow_becoming: 'Marked as outgrown.',
  restore: 'Brought back.',
};

/**
 * The slot after `action` turned `before` into `after`. Background ticks keep the
 * slot; anything else the person does replaces it, so undo never erases newer work.
 */
export function track(slot: UndoSlot | undefined, action: Action, before: AppState, after: AppState): UndoSlot | undefined {
  if (action.type === 'tick' || action.type === 'open' || action.type === 'backgrounded' || action.type === 'sync_merge' || action.type === 'evidence_shown' || action.type === 'hint_seen') return slot;
  if (after === before) return slot;
  // Onboarding's choices are a batch the person reviews on screen; a lone "Undo" for the last one would confuse.
  if (!before.onboarding.completedAt) return undefined;
  const label = LABELS[action.type];
  return label ? { label, at: action.at, before } : undefined;
}

export function isFresh(slot: UndoSlot | undefined, now: number): slot is UndoSlot {
  return !!slot && now - Date.parse(slot.at) < UNDO_MS;
}
