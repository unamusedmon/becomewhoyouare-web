/**
 * Tooltips for a touch screen: one short line, shown once, at the moment a
 * feature is in front of you. Picking which one shows is pure so the rules are
 * testable: never more than one at a time, never right after another, and
 * never again once seen or used.
 */
import type { ISODateTime } from './model';

/** In priority order: earlier ones win when several apply at once. */
export const HINT_IDS = ['energy', 'mic', 'rename', 'also_here', 'plan', 'undo', 'set_aside'] as const;
export type HintId = (typeof HINT_IDS)[number];

export interface HintSettings {
  enabled: boolean;
  /** When each hint was dismissed or made pointless by using the feature. */
  seen: Partial<Record<HintId, ISODateTime>>;
}

export const initialHints: HintSettings = { enabled: true, seen: {} };

/** A breath between hints, so they never stack up into a tutorial. */
export const HINT_GAP_MS = 45_000;

function lastSeen(h: HintSettings): number {
  let last = 0;
  for (const at of Object.values(h.seen)) last = Math.max(last, Date.parse(at ?? '') || 0);
  return last;
}

/**
 * The one hint to show now, given which ones the current screen could show.
 * `showing` keeps a hint on screen once it appeared, even if the gap rule would
 * now say otherwise, so it never flickers away mid-read.
 */
export function pickHint(h: HintSettings, eligible: HintId[], now: number, showing?: HintId): HintId | undefined {
  if (!h.enabled) return undefined;
  if (showing && eligible.includes(showing) && !h.seen[showing]) return showing;
  if (now - lastSeen(h) < HINT_GAP_MS) return undefined;
  return HINT_IDS.find((id) => eligible.includes(id) && !h.seen[id]);
}

export function markSeen(h: HintSettings, id: HintId, at: ISODateTime): HintSettings {
  return h.seen[id] ? h : { ...h, seen: { ...h.seen, [id]: at } };
}
