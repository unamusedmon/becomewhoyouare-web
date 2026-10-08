/**
 * Turns a spoken brain dump into separate tasks. People talk in run-ons:
 * "um I need to call mom and then fix the computer oh and taxes". Speech
 * recognizers on Android rarely add punctuation, so we split on the phrases
 * people use to move to the next thing, not on commas or a bare "and"
 * ("salt and pepper" is one thing).
 */

/** Phrases that start a new item. Order matters: longer phrases first. */
const SEPARATORS = [
  'and then', 'and also', 'oh and', 'oh also', 'after that', 'another thing is', 'another thing', 'also', 'plus',
];

/** Ways people introduce a task. Mid-sentence they mark a new item; at the start they are dropped. */
const INTROS = [
  "i've got to", 'i have got to', 'i need to', 'i have to', 'i gotta', 'i should', 'i must', 'i want to',
  "don't forget to", 'do not forget to', 'remember to', 'i got to',
];

const FILLERS = /^(?:(?:um+|uh+|er+|erm|so|okay|ok|like|well|alright|right|and|yeah)\b[\s,]*)+/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\']/g, (c) => (c === "'" ? "['’]" : `\\${c}`));
const SPLIT = new RegExp(
  `[.?!;\\n]+|\\s*,?\\s*\\b(?:${SEPARATORS.map(escape).join('|')})\\b\\s*|\\s+(?:and\\s+)?(?=\\b(?:${INTROS.map(escape).join('|')})\\b)`,
  'i',
);
const LEADING_INTRO = new RegExp(`^(?:${INTROS.map(escape).join('|')})\\b\\s*`, 'i');

function tidy(part: string): string {
  let t = part.trim().replace(/\s+/g, ' ');
  // Fillers and intros can stack: "so um I need to".
  for (let i = 0; i < 3; i++) t = t.replace(FILLERS, '').replace(LEADING_INTRO, '');
  t = t.replace(/[\s,]+(?:and|um+|uh+)?[\s,]*$/i, '').replace(/^[\s,]+/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function splitSpoken(transcript: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of transcript.split(SPLIT)) {
    const t = tidy(part ?? '');
    const key = t.toLowerCase();
    // One word of noise ("yeah", "so") is not a task; a real one-word task ("taxes") is.
    if (t.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
