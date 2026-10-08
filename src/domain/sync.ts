/**
 * Merging two copies of the app's state, one from this device and one from another
 * (via WebDAV, see src/state/sync.ts). Pure, so the rules are testable:
 *
 * - Tasks, routines and becomings merge by id; the copy changed most recently wins.
 *   Nothing is ever deleted in this app (let go is a state, not a deletion), so a
 *   missing item just means the other side hasn't seen it yet.
 * - Events and recurrence verdicts are append-only: union by id. Two devices can
 *   both spawn the same routine occurrence, so duplicate "created" events collapse.
 * - Settings that belong to the person (energy, recurrence, calibration, the
 *   first-step test, onboarding) come from whichever side changed last.
 * - Settings that belong to the device stay local: notifications (the web can't
 *   send them) and which hints this screen has shown.
 */
import type { AppState } from './reducer';
import type { ISODateTime, TaskEvent } from './model';

/** What goes over the wire. Device-only settings are left out. */
export type SyncedState = Omit<AppState, 'nudges' | 'hints'>;

export interface RemoteFile {
  format: 'become-who-you-are/sync';
  version: 1;
  writtenAt: ISODateTime;
  state: SyncedState;
}

export function toRemote(state: AppState, at: ISODateTime): RemoteFile {
  const { nudges: _n, hints: _h, ...synced } = state;
  return { format: 'become-who-you-are/sync', version: 1, writtenAt: at, state: synced };
}

export function parseRemote(text: string): RemoteFile | undefined {
  try {
    const parsed = JSON.parse(text) as RemoteFile;
    return parsed?.format === 'become-who-you-are/sync' && parsed.version === 1 && parsed.state ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const ms = (at: ISODateTime | undefined) => (at ? Date.parse(at) || 0 : 0);

function byNewest<T extends { id: string }>(mine: T[], theirs: T[], stamp: (x: T) => ISODateTime | undefined): T[] {
  const out = new Map(mine.map((x) => [x.id, x]));
  for (const x of theirs) {
    const local = out.get(x.id);
    if (!local || ms(stamp(x)) > ms(stamp(local))) out.set(x.id, x);
  }
  // Keep this device's order, then anything new in creation order.
  const seen = new Set(mine.map((x) => x.id));
  return [...mine.map((x) => out.get(x.id)!), ...theirs.filter((x) => !seen.has(x.id))];
}

function unionEvents(mine: TaskEvent[], theirs: TaskEvent[]): TaskEvent[] {
  const ids = new Set<string>();
  const created = new Set<string>();
  const out: TaskEvent[] = [];
  for (const e of [...mine, ...theirs].sort((a, b) => ms(a.at) - ms(b.at))) {
    if (ids.has(e.id)) continue;
    if (e.type === 'created') {
      if (created.has(e.taskId)) continue;
      created.add(e.taskId);
    }
    ids.add(e.id);
    out.push(e);
  }
  return out;
}

function maxRecord(a: Record<string, ISODateTime>, b: Record<string, ISODateTime>): Record<string, ISODateTime> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || ms(v) > ms(out[k])) out[k] = v;
  return out;
}

/** Commutative for entities and events; for settings, the later `changedAt` wins. */
export function mergeStates(local: AppState, remote: SyncedState): AppState {
  const remoteNewer = ms(remote.changedAt) > ms(local.changedAt);
  const newer = remoteNewer ? remote : local;
  const verdictIds = new Set(local.verdicts.map((v) => v.id));
  const onboarded = [local.onboarding.completedAt, remote.onboarding?.completedAt].filter(Boolean).sort()[0];
  const sessionDay = [local.recurrence.lastSessionDay, remote.recurrence?.lastSessionDay].filter(Boolean).sort().at(-1);
  return {
    ...local,
    tasks: byNewest(local.tasks, remote.tasks ?? [], (t) => t.updatedAt),
    routines: byNewest(local.routines, remote.routines ?? [], (r) => r.updatedAt),
    becomings: byNewest(local.becomings, remote.becomings ?? [], (b) => b.updatedAt ?? b.createdAt),
    events: unionEvents(local.events, remote.events ?? []),
    verdicts: [...local.verdicts, ...(remote.verdicts ?? []).filter((v) => !verdictIds.has(v.id))]
      .sort((a, b) => ms(a.askedAt) - ms(b.askedAt)),
    energy: newer.energy,
    pinnedNowId: newer.pinnedNowId,
    profile: { ...local.profile, ...newer.profile },
    recurrence: { ...local.recurrence, ...newer.recurrence, lastSessionDay: sessionDay },
    experiments: { ...local.experiments, ...newer.experiments },
    onboarding: { ...local.onboarding, completedAt: onboarded },
    overcoming: { lastShownAt: maxRecord(local.overcoming.lastShownAt, remote.overcoming?.lastShownAt ?? {}) },
    changedAt: remoteNewer ? remote.changedAt : local.changedAt,
  };
}
