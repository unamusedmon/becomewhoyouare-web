import type { EnergyCost } from './model';

export type Category =
  | 'email' | 'call' | 'text' | 'appointment' | 'fix' | 'write' | 'clean' | 'admin'
  | 'shop' | 'exercise' | 'read' | 'generic';

// Order matters: the first match wins ("email the dentist" is email, not appointment).
const CATEGORY_KEYWORDS: [Category, RegExp][] = [
  ['email', /\b(e-?mail|gmail|inbox|reply to)\b/],
  ['text', /\b(text|message|dm|whatsapp|slack)\b/],
  ['call', /\b(call|phone|ring)\b/],
  ['appointment', /^book\b|\b(schedule|appointment|dentist|doctor|therapist|haircut|vet)\b/],
  ['fix', /\b(fix|repair|broken|troubleshoot|reinstall|reboot)\b/],
  ['admin', /\b(tax(es)?|bills?|pay|invoice|forms?|paperwork|insurance|bank|renew|passport|budget)\b/],
  ['write', /\b(write|draft|essay|chapter|report|paper|post|blog|thesis|article|proposal|resume|cv)\b/],
  ['clean', /\b(clean|tidy|dishes|laundry|vacuum|mop|declutter|trash|bathroom|kitchen)\b/],
  ['shop', /\b(buy|shop|shopping|groceries|order|pick up)\b/],
  ['exercise', /\b(gym|go for a (run|walk|swim)|running|jog|workout|work out|yoga|swim|lift weights|exercise|bike ride)\b/],
  ['read', /\b(read|book|study|chapter of|article)\b/],
];

export function categorize(title: string): Category {
  const t = title.toLowerCase();
  for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(t)) return cat;
  return 'generic';
}

const DEEP = /\b(write|draft|code|design|study|essay|thesis|chapter|report|proposal|taxes|budget|plan|learn|research|analy[sz]e)\b/;
const AUTOPILOT = /\b(laundry|dishes|trash|water|text|tidy|groceries|pick up|take out|feed|charge|walk)\b/;

/** Messages and calls are rarely deep work, even when the title says "draft". */
const MEDIUM_AT_MOST: Category[] = ['email', 'text', 'call', 'appointment', 'shop'];

export function inferEnergy(title: string): EnergyCost {
  const t = title.toLowerCase();
  if (MEDIUM_AT_MOST.includes(categorize(t))) return AUTOPILOT.test(t) || categorize(t) === 'text' ? 'autopilot' : 'medium';
  if (DEEP.test(t)) return 'deep';
  if (AUTOPILOT.test(t)) return 'autopilot';
  return 'medium';
}

const LEADING_VERBS =
  /^(please\s+)?(i need to|need to|have to|gotta|should|must|remember to|don't forget to|try to)?\s*(write|do|finish|send|call|email|e-mail|text|clean|go to|pay|buy|fix|repair|troubleshoot|make|book|schedule|start|work on|deal with|handle|read|study|get|reply to|order|renew|file|sort out|sort)?\s*/i;

/** "Write email draft to landlord" → "email draft to landlord". Keeps at most 5 words. */
export function extractObject(title: string): string {
  const stripped = title.trim().replace(LEADING_VERBS, '').replace(/[.!?]+$/, '').trim();
  const base = stripped || title.trim();
  return base.split(/\s+/).slice(0, 5).join(' ');
}

/** "email the landlord about the leak" → "the landlord". Used for "Hi {who}" and contacts. */
const NOT_A_PERSON = /^(about|for|re|back|and|draft|reply|the|my|a|an|it|them|up|out)$/i;

export function extractRecipient(title: string): string | undefined {
  const patterns = [
    /\bto\s+((?:my\s+|the\s+)?[A-Za-z][\w'-]*)/i,
    /\b(?:call|text|email|e-mail|ring|message|phone)\s+((?:my\s+|the\s+)?[A-Za-z][\w'-]*)/i,
  ];
  for (const re of patterns) {
    const m = title.match(re);
    if (!m) continue;
    const who = m[1].trim();
    const last = who.split(/\s+/).pop() ?? '';
    if (!NOT_A_PERSON.test(last)) return who;
  }
  return undefined;
}
