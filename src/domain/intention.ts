/**
 * Implementation intentions: "When X, I'll do Y." Planning the cue hands the start
 * over to the situation instead of to willpower. Effects are reliable but moderate
 * (Sheeran, Listrom & Gollwitzer 2024: .27 ≤ d ≤ .66 across 642 tests). See docs/design/06-science-audit.md.
 */
import type { ImplementationIntention, ISODateTime, Task } from './model';

/** Common anchors: things that already happen every day, so the plan rides on them. */
export const CUE_SUGGESTIONS = [
  'I finish my coffee',
  'I sit down at my desk',
  'lunch is over',
  'I get home',
  'the kids are asleep',
];

/** "When I finish coffee." → "I finish coffee". People type the "when" themselves half the time. */
export function cleanCue(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(when(ever)?|once|as soon as|after)(\s+|$)/i, '')
    .replace(/[,.;:!?]+$/, '')
    .trim();
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** "9:30 PM" in the phone's own format. */
export function timeOfDay(at: ISODateTime): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "at 9:30 PM", "at 9:00 AM tomorrow", "at 9:00 AM on Fri". */
export function whenLabel(at: ISODateTime, now: Date = new Date()): string {
  const days = Math.round((startOfDay(new Date(at)) - startOfDay(now)) / DAY);
  const day = days <= 0 ? '' : days === 1 ? ' tomorrow' : ` on ${new Date(at).toLocaleDateString([], { weekday: 'short' })}`;
  return `at ${timeOfDay(at)}${day}`;
}

/** Next moment the clock reads h:m, at least a minute from now. */
function nextAt(h: number, m: number, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (d.getTime() < now.getTime() + 60_000) d.setDate(d.getDate() + 1);
  return d;
}

/** "9", "9:30", "9pm", "9:30 pm", "21:15" → the next time it comes round. Anything else → undefined. */
export function parseClock(text: string, now: Date = new Date()): Date | undefined {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59 || h > 23 || (m[3] && (h < 1 || h > 12))) return undefined;
  if (m[3]?.startsWith('p') && h < 12) h += 12;
  if (m[3]?.startsWith('a') && h === 12) h = 0;
  return nextAt(h, min, now);
}

/** A few times people actually mean. Clock times are allowed, never the only support. */
export function timePresets(now: Date = new Date()): { label: string; at: Date }[] {
  const inAnHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 300_000) * 300_000);
  const presets = [{ label: 'in an hour', at: inAnHour }];
  if (now.getHours() < 18) presets.push({ label: 'this evening', at: nextAt(19, 0, now) });
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  presets.push({ label: 'tomorrow morning', at: tomorrow });
  return presets;
}

export function cueText(intention: ImplementationIntention, tasks: Task[], now: Date = new Date()): string {
  if (intention.trigger.kind === 'event') return `When ${intention.trigger.text}`;
  if (intention.trigger.kind === 'time') {
    const label = whenLabel(intention.trigger.at, now);
    return label[0].toUpperCase() + label.slice(1);
  }
  const anchorId = intention.trigger.taskId;
  const anchor = tasks.find((t) => t.id === anchorId);
  return `After ${anchor ? lowerFirst(anchor.title) : 'the other thing'}`;
}

/** "When I finish my coffee, at my desk, I'll open the report doc." */
export function intentionSentence(task: Task, tasks: Task[]): string {
  const i = task.intention;
  if (!i) return '';
  const where = i.context ? `, ${i.context.trim()}` : '';
  return `${cueText(i, tasks)}${where}, I'll ${lowerFirst(task.firstStep.text.replace(/[.!]+$/, ''))}.`;
}

/** "If I open Twitter instead, then I'll close it and type one bullet." */
export function obstacleSentence(i: ImplementationIntention): string | undefined {
  if (!i.ifObstacle) return undefined;
  let obstacle = cleanCue(i.ifObstacle.obstacle.replace(/^if\s+/i, ''));
  // The field is labelled "If I…", so most people type only the rest.
  if (!/^(i|i'm|i've|my|it|the|a|an|someone|they|he|she|we|you)\b/i.test(obstacle)) obstacle = `I ${obstacle}`;
  const response = i.ifObstacle.response.trim().replace(/^(then\s+)?(i'?ll\s+)?/i, '').replace(/[.!]+$/, '');
  return `If ${obstacle}, then I'll ${lowerFirst(response)}.`;
}

/**
 * When a planned task gets started, set aside or released, its cue has done its job.
 * Event cues re-arm for next time; an "after X" cue is spent once X is done.
 */
export function settleIntention(task: Task): Task {
  const i = task.intention;
  if (!i?.firedAt) return task;
  // A clock time or "after X" is a one-off: once used, it's spent.
  if (i.trigger.kind !== 'event') return { ...task, intention: undefined };
  return { ...task, intention: { ...i, firedAt: undefined } };
}

export function isWaitingOnCue(task: Task): boolean {
  return !!task.intention && !task.intention.firedAt;
}
