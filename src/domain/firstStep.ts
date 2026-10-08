/**
 * Smallest-first-step generation (docs/design/02-first-step-flow.md).
 *
 * This slice ships the offline template generator plus the rule validator.
 * The model-backed generator comes later behind a server, and its output goes
 * through the same validateFirstStep() before it can reach the screen.
 */
import { categorize, extractObject, extractRecipient, type Category } from './classify';
import type { FirstStep, UserProfile } from './model';

export const PHYSICAL_VERBS = new Set([
  'open', 'type', 'put', 'pick', 'write', 'tap', 'walk', 'fill', 'set', 'plug', 'take',
  'clear', 'sit', 'stand', 'look', 'find', 'read', 'lay', 'move', 'hold', 'grab', 'place',
  'turn', 'press', 'close', 'stack', 'carry', 'fold', 'wash', 'click', 'say', 'drink',
]);

export const BANNED_LEAD_VERBS = new Set([
  'think', 'consider', 'plan', 'decide', 'figure', 'research', 'review', 'prepare', 'organize',
  'brainstorm', 'reflect', 'try', 'start', 'begin', 'work', 'deal', 'handle',
]);

const DECISION_PHRASES = /\b(decide|figure out|plan|research|brainstorm|think about|consider|organi[sz]e|choose|prioriti[sz]e)\b/i;

export const MAX_WORDS = 15;
export const MAX_SECONDS = 120;

export interface Validation {
  ok: boolean;
  reasons: string[];
}

export function validateFirstStep(text: string, estSeconds = 60): Validation {
  const reasons: string[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  // Quoted text is the user's own task title, not an instruction, so it can't hide a decision.
  const unquoted = text.replace(/"[^"]*"/g, '""');
  const verb = (words[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (BANNED_LEAD_VERBS.has(verb)) reasons.push(`starts with a promise, not an action ("${verb}")`);
  else if (!PHYSICAL_VERBS.has(verb)) reasons.push(`does not start with a physical verb ("${verb}")`);
  if (DECISION_PHRASES.test(unquoted)) reasons.push('hides a decision inside it');
  if (words.length > MAX_WORDS) reasons.push(`too long (${words.length} words)`);
  if (estSeconds > MAX_SECONDS) reasons.push('takes longer than two minutes');
  if (words.length < 2) reasons.push('names no object');
  return { ok: reasons.length === 0, reasons };
}

interface Ctx {
  obj: string;
  /** obj without its article, for templates that supply their own: "the invoice" → "invoice". */
  bare: string;
  /** The title itself, shortened, for steps that quote it. */
  quoted: string;
  who: string;
  mail: string;
  docs: string;
  dishes: boolean;
  laundry: boolean;
}

type Ladder = { candidates: [string, string, string]; shrink: [string, string] };

const LADDERS: Record<Category, (c: Ctx) => Ladder> = {
  email: (c) => ({
    candidates: [
      `Open ${c.mail} and type the subject line`,
      `Put your phone down and open ${c.mail} on the laptop`,
      `Type "Hi ${c.who}" and nothing else`,
    ],
    shrink: [`Open ${c.mail}`, 'Pick up the device you email from'],
  }),
  text: (c) => ({
    candidates: [
      `Open your chat with ${c.who}`,
      `Pick up your phone and open messages`,
      `Type one word to ${c.who}. Any word`,
    ],
    shrink: ['Pick up your phone', 'Put your phone on the table in front of you'],
  }),
  call: (c) => ({
    candidates: [
      `Open ${c.who}'s contact on your phone`,
      `Write ${c.who}'s number on a sticky note`,
      'Tap call. You can hang up if it rings out',
    ],
    shrink: ['Pick up your phone', 'Put your phone on the table in front of you'],
  }),
  appointment: (c) => ({
    candidates: [
      `Open the website or contact for ${c.obj}`,
      'Open your calendar and find one free slot',
      'Tap call. You can hang up if it rings out',
    ],
    shrink: ['Pick up your phone', 'Put your phone on the table in front of you'],
  }),
  write: (c) => ({
    candidates: [
      `Open ${c.obj} and read the last paragraph`,
      `Sit at the desk and open ${c.docs}`,
      'Type one ugly sentence. Make it bad on purpose',
    ],
    shrink: [`Open ${c.docs}`, 'Sit down where you write'],
  }),
  clean: (c) => ({
    candidates: c.laundry
      ? ['Put the laundry basket by the machine', 'Pick up five clothes off the floor', 'Open the washer door. That counts']
      : c.dishes
      ? ['Put three dishes in the sink', 'Fill the sink with hot water', 'Wash one fork. Just the fork']
      : ['Put three things where they go', 'Take the trash bag out of the bin', 'Clear one square foot of counter, any foot'],
    shrink: ['Pick up one thing and put it away', 'Stand in the room'],
  }),
  fix: (c) => ({
    candidates: [
      `Write one line about what is wrong with the ${c.bare}`,
      'Take a photo of the problem with your phone',
      `Turn on the ${c.bare} and look at what it does`,
    ],
    shrink: [`Sit down in front of the ${c.bare}`, `Put your hand on the ${c.bare}`],
  }),
  admin: (c) => ({
    candidates: [
      `Put the ${c.bare} paperwork on the table`,
      `Open the ${c.bare} website on the laptop`,
      'Find one document and put it on top of the pile',
    ],
    shrink: ['Pick up the folder', 'Look at where the paperwork is'],
  }),
  shop: () => ({
    candidates: [
      'Open a note and type the first item',
      'Put your shopping bag by the door',
      'Open the store app and search one item',
    ],
    shrink: ['Open your notes app', 'Pick up your phone'],
  }),
  exercise: () => ({
    candidates: [
      'Put your gym shoes by the door',
      'Put on workout clothes',
      "Fill your water bottle. That's the whole job",
    ],
    shrink: ['Pick up your shoes', 'Put one sock on'],
  }),
  read: (c) => ({
    candidates: [
      `Open ${c.obj} to where you stopped`,
      `Put ${c.obj} on your pillow`,
      'Read one paragraph, standing up',
    ],
    shrink: [`Pick up ${c.obj}`, `Look at where ${c.obj} is`],
  }),
  // Unknown shape: quote the user's words instead of guessing at grammar.
  generic: (c) => ({
    candidates: [
      `Put what you need for "${c.quoted}" in front of you`,
      'Stand up and walk to where this happens',
      'Set a timer for one song and touch the first piece',
    ],
    // Even the smallest rung names the task, so it never reads as a random chore.
    shrink: [`Put one thing for "${c.quoted}" in front of you`, `Sit down where "${c.quoted}" happens`],
  }),
};

function ctxFor(title: string, profile: UserProfile): Ctx {
  const words = title.trim().split(/\s+/);
  const obj = extractObject(title).replace(/^taxes$/i, 'tax');
  return {
    obj,
    bare: obj.replace(/^(the|my|our|your|a|an)\s+/i, ''),
    quoted: words.length > 5 ? `${words.slice(0, 5).join(' ')}…` : words.join(' '),
    who: extractRecipient(title) ?? 'them',
    mail: profile.knownTools.mail ?? 'your email',
    docs: profile.knownTools.docs ?? 'the doc',
    dishes: /\bdishes\b/i.test(title),
    laundry: /\blaundry\b/i.test(title),
  };
}

const GENERIC_SAFE = 'Put the thing in front of you';

function firstVerb(text: string): string {
  return (text.split(/\s+/)[0] ?? '').toLowerCase();
}

function asStep(text: string, shrinkDepth: number, alternatives?: string[]): FirstStep {
  return {
    text,
    verb: firstVerb(text),
    estSeconds: 60,
    source: 'template',
    shrinkDepth,
    alternatives,
  };
}

/** Three validated candidates; the first is shown, the others are one tap away. */
export function generateFirstStep(title: string, profile: UserProfile): FirstStep {
  const ladder = LADDERS[categorize(title)](ctxFor(title, profile));
  const valid = ladder.candidates.filter((t) => validateFirstStep(t).ok);
  const [first, ...rest] = valid.length ? valid : [GENERIC_SAFE];
  return asStep(first, 0, rest);
}

/** Cycle to the next alternative (the shown step goes to the back of the queue). */
export function nextAlternative(step: FirstStep): FirstStep {
  const alts = step.alternatives ?? [];
  if (!alts.length) return step;
  const [next, ...rest] = alts;
  return { ...step, text: next, verb: firstVerb(next), alternatives: [...rest, step.text] };
}

/** At this depth the problem is probably not size; the UI offers reshaping instead. */
export const RESHAPE_DEPTH = 3;

/** "Still too big": a strictly smaller step. Returns null once shrinking stops making sense. */
export function shrinkFirstStep(title: string, step: FirstStep, profile: UserProfile): FirstStep | null {
  const depth = step.shrinkDepth + 1;
  if (depth >= RESHAPE_DEPTH) return null;
  const ladder = LADDERS[categorize(title)](ctxFor(title, profile));
  const text = ladder.shrink[depth - 1];
  return asStep(validateFirstStep(text).ok ? text : GENERIC_SAFE, depth);
}

/** The bottom rung of the shrink ladder. A step the person wrote themselves is theirs, so it stays. */
export function smallestFirstStep(title: string, step: FirstStep, profile: UserProfile): FirstStep {
  if (step.source === 'user') return step;
  let current = step;
  for (let next = shrinkFirstStep(title, current, profile); next; next = shrinkFirstStep(title, current, profile)) current = next;
  return current;
}
