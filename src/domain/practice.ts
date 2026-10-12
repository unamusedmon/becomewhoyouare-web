/**
 * The daily practice, as an opt-in pack of routines: the morning demon's question,
 * a chosen hardship, a walk, the evening review and the Sunday hammer audit. Nothing
 * is added until the person asks for it in Settings.
 *
 * Ids are fixed, so adding the pack on two devices yields one set of routines after
 * sync, and adding it again only fills in what's missing. A practice the person let
 * go stays let go: it's still in `routines`, so it isn't added back.
 */
import type { LooseCadence } from './model';
import type { AppState } from './state';

export interface Practice {
  id: string;
  title: string;
  cadence: LooseCadence;
}

export const PRACTICES: readonly Practice[] = [
  { id: 'practice-demon', title: "Morning: write the one thing today can't lack", cadence: 'daily' },
  { id: 'practice-hardship', title: 'Do one chosen hardship, early', cadence: 'few_per_week' },
  { id: 'practice-walk', title: 'Walk without headphones, carrying one problem', cadence: 'few_per_week' },
  { id: 'practice-evening', title: 'Evening: three necessary things, then score the day 1 to 5', cadence: 'daily' },
  { id: 'practice-hammer', title: 'Hammer audit: tap one idol, pick next week\'s friction', cadence: 'weekly' },
];

/** Practices not yet in this state, in any status. */
export function missingPractices(state: Pick<AppState, 'routines'>): Practice[] {
  const have = new Set(state.routines.map((r) => r.id));
  return PRACTICES.filter((p) => !have.has(p.id));
}

