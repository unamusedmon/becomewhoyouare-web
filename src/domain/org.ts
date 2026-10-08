/**
 * The whole app as an Org file, written next to the sync data so Emacs, Orgzly or
 * any Org tool can read it, and edited back: change a keyword, retitle a heading,
 * rewrite FIRST_STEP, or add a new heading. Pure functions; src/state/sync.ts does I/O.
 *
 * Edits are found by comparing the file with what the app wrote last time (rendered
 * again from the synced state), so only what a person changed in Org is applied,
 * and a stale file never undoes newer work done in the app.
 */
import type { Action } from './reducer';
import type { ID, ISODateTime, LooseCadence, Task, TaskState } from './model';
import type { SyncedState } from './sync';

export const KEYWORDS: Record<TaskState, string> = {
  open: 'TODO',
  started: 'NEXT',
  resting: 'WAITING',
  done: 'DONE',
  released: 'CANCELLED',
};
const STATE_OF: Record<string, TaskState> = Object.fromEntries(
  Object.entries(KEYWORDS).map(([state, kw]) => [kw, state as TaskState]),
);

/** Done and let-go tasks stay in the file this long, so it doesn't grow forever. */
export const RECENT_DAYS = 14;

export const SECTIONS = {
  becoming: 'Becoming',
  tasks: 'Tasks',
  routines: 'Routines',
  aside: 'Set aside',
  done: 'Done',
} as const;

/** Which sync wrote this file. Edits count only if it matches the data file, so a stale .org never undoes newer work. */
const STAMP = 'BWYA_SYNCED';

export function orgStamp(text: string): string | undefined {
  return text.match(new RegExp(`^#\\+${STAMP}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
}

const CADENCES: LooseCadence[] = ['daily', 'few_per_week', 'weekly', 'monthly'];

/** Org titles are one line; a stray leading star or keyword would change the structure. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stamp(at: ISODateTime): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${day} ${pad(d.getHours())}:${pad(d.getMinutes())}]`;
}

function heading(level: number, keyword: string | undefined, title: string, props: Record<string, string | undefined>, extra: string[] = []): string[] {
  const indent = ' '.repeat(level + 1);
  const lines = [`${'*'.repeat(level)} ${keyword ? `${keyword} ` : ''}${oneLine(title)}`, ...extra.map((l) => indent + l), `${indent}:PROPERTIES:`];
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== '') lines.push(`${indent}:${k}: ${oneLine(v)}`);
  lines.push(`${indent}:END:`);
  return lines;
}

function taskHeading(t: Task): string[] {
  const closed = t.state === 'done' || t.state === 'released' ? [`CLOSED: ${stamp(t.updatedAt)}`] : [];
  return heading(2, KEYWORDS[t.state], t.title, {
    ID: t.id,
    FIRST_STEP: t.firstStep.text,
    ENERGY: t.energy,
    ROUTINE: t.routineId,
  }, closed);
}

export function renderOrg(state: SyncedState, asOf: ISODateTime): string {
  const recent = (t: Task) => Date.parse(asOf) - Date.parse(t.updatedAt) <= RECENT_DAYS * 86_400_000;
  const lines = [
    '#+TITLE: Become Who You Are',
    '#+TODO: TODO NEXT WAITING | DONE CANCELLED',
    '#+STARTUP: overview',
    `#+${STAMP}: ${asOf}`,
    '# Written by the app on every sync. Edit freely: change a keyword (TODO, NEXT, WAITING,',
    '# DONE, CANCELLED), retitle a heading, rewrite FIRST_STEP, or add a new heading under',
    '# Tasks, Becoming or Routines. Deleting a heading does nothing; mark it CANCELLED instead.',
    `# Leave the ${STAMP} line alone: it tells the app which version you edited.`,
    '',
    `* ${SECTIONS.becoming}`,
    ...state.becomings.filter((b) => b.status === 'active').flatMap((b) => heading(2, undefined, b.statement, { ID: b.id })),
    `* ${SECTIONS.tasks}`,
    ...state.tasks.filter((t) => t.state === 'open' || t.state === 'started').flatMap(taskHeading),
    `* ${SECTIONS.routines}`,
    ...state.routines.filter((r) => r.status === 'active').flatMap((r) =>
      heading(2, undefined, r.title, { ID: r.id, CADENCE: r.cadence, STANDING: r.nature === 'toll' ? 'toll' : r.recurrence.standing })),
    `* ${SECTIONS.aside}`,
    ...state.tasks.filter((t) => t.state === 'resting' || (t.state === 'released' && recent(t))).flatMap(taskHeading),
    `* ${SECTIONS.done}`,
    ...state.tasks.filter((t) => t.state === 'done' && recent(t)).flatMap(taskHeading),
    '',
  ];
  return lines.join('\n');
}

export interface OrgItem {
  section: string;
  keyword?: string;
  title: string;
  props: Record<string, string>;
}

const HEADLINE = /^(\*+)\s+(.*)$/;
const PROP = /^\s*:([A-Za-z_][\w-]*):\s*(.*)$/;

/** Level-2 headings under each top-level section, with their properties. Anything deeper is the person's own notes. */
export function parseOrg(text: string): OrgItem[] {
  const items: OrgItem[] = [];
  let section = '';
  let current: OrgItem | undefined;
  let inDrawer = false;
  for (const raw of text.split(/\r?\n/)) {
    const h = raw.match(HEADLINE);
    if (h) {
      inDrawer = false;
      const level = h[1].length;
      if (level === 1) { section = oneLine(h[2]); current = undefined; continue; }
      if (level !== 2) { current = undefined; continue; }
      let rest = h[2].replace(/\s+:[\w@#%:]+:\s*$/, ''); // trailing tags
      const kw = rest.match(/^([A-Z]+)\s+(.*)$/);
      let keyword: string | undefined;
      if (kw && kw[1] in STATE_OF) { keyword = kw[1]; rest = kw[2]; }
      rest = rest.replace(/^\[#[A-C]\]\s*/, ''); // priority cookie
      current = { section, keyword, title: oneLine(rest), props: {} };
      items.push(current);
      continue;
    }
    if (!current) continue;
    if (/^\s*:PROPERTIES:\s*$/.test(raw)) { inDrawer = true; continue; }
    if (/^\s*:END:\s*$/.test(raw)) { inDrawer = false; continue; }
    const p = inDrawer ? raw.match(PROP) : null;
    if (p) current.props[p[1].toUpperCase()] = p[2].trim();
  }
  return items;
}

type NoAt<A> = A extends unknown ? Omit<A, 'at'> : never;
export type OrgAction = NoAt<Action>;

/** The keyword change, as the action that makes it happen from where the task is now. */
function moveTo(task: Task, target: TaskState): OrgAction | undefined {
  if (task.state === target) return undefined;
  switch (target) {
    case 'done': return { type: 'complete', taskId: task.id };
    case 'released': return { type: 'release', taskId: task.id };
    case 'resting': return { type: 'rest', taskId: task.id };
    case 'started': return task.state === 'open' ? { type: 'first_step_done', taskId: task.id } : undefined;
    // Back to TODO works from set aside or let go. Un-doing a DONE isn't a thing the app does.
    case 'open': return task.state === 'resting' || task.state === 'released' ? { type: 'restore', taskId: task.id } : undefined;
  }
}

/**
 * What the person changed in Org, as app actions. `base` is the file as the app last
 * wrote it, `edited` the file now, `state` the app's merged state (so changes that
 * already happened aren't repeated). `newId` names anything new.
 */
export function orgEdits(base: string, edited: string, state: SyncedState, newId: () => ID): OrgAction[] {
  if (base === edited) return [];
  const before = new Map(parseOrg(base).filter((i) => i.props.ID).map((i) => [i.props.ID, i]));
  const tasks = new Map(state.tasks.map((t) => [t.id, t]));
  const becomings = new Map(state.becomings.map((b) => [b.id, b]));
  const knownIds = new Set([...tasks.keys(), ...becomings.keys(), ...state.routines.map((r) => r.id)]);
  const out: OrgAction[] = [];

  for (const item of parseOrg(edited)) {
    const id = item.props.ID;
    const was = id ? before.get(id) : undefined;

    if (id && was) {
      const task = tasks.get(id);
      if (task) {
        if (item.title && item.title !== was.title && item.title !== task.title) out.push({ type: 'rename', taskId: id, title: item.title });
        const step = item.props.FIRST_STEP;
        if (step && step !== was.props.FIRST_STEP && step !== task.firstStep.text) out.push({ type: 'edit_step', taskId: id, text: step });
        if (item.keyword && item.keyword !== was.keyword) {
          const move = moveTo(task, STATE_OF[item.keyword]);
          if (move) out.push(move);
        }
        continue;
      }
      const becoming = becomings.get(id);
      if (becoming && item.title && item.title !== was.title && item.title !== becoming.statement) {
        out.push({ type: 'edit_becoming', id, statement: item.title });
      }
      continue;
    }

    // New heading (no ID, or an ID nobody knows, e.g. copied from elsewhere).
    if ((id && knownIds.has(id)) || !item.title) continue;
    if (item.section === SECTIONS.becoming) {
      out.push({ type: 'add_becoming', id: newId(), statement: item.title });
    } else if (item.section === SECTIONS.routines) {
      const cadence = CADENCES.find((c) => c === item.props.CADENCE) ?? 'weekly';
      out.push({ type: 'add_routine', id: newId(), title: item.title, cadence });
    } else if (item.keyword !== 'DONE' && item.keyword !== 'CANCELLED') {
      // Anything else that looks like a task becomes one, wherever it was added.
      out.push({ type: 'capture', id: newId(), title: item.title });
    }
  }
  return out;
}

/**
 * Edits in `text` relative to the data file it was written with. A file written by an
 * older sync (org was off for a while, or another device synced without it) is ignored,
 * since diffing it against today's state would read every later change as an edit.
 */
export function editsSince(text: string, remote: { state: SyncedState; writtenAt: ISODateTime }, state: SyncedState, newId: () => ID): OrgAction[] {
  if (orgStamp(text) !== remote.writtenAt) return [];
  return orgEdits(renderOrg(remote.state, remote.writtenAt), text, state, newId);
}
