#!/usr/bin/env node
/**
 * The phone app and the web app each carry a copy of the shared rules (src/domain:
 * the model, reducer, sync format, Org and encryption). If the copies drift, the
 * phone and the browser stop understanding each other's sync file, quietly.
 *
 *   node scripts/check-shared-domain.mjs <this repo's src/domain> <the sibling's src/domain>
 *
 * Exits 1 and lists every file that differs or exists on one side only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [mine, theirs] = process.argv.slice(2);
if (!mine || !theirs) {
  console.error('usage: check-shared-domain.mjs <src/domain here> <src/domain in the sibling repo>');
  process.exit(2);
}

function files(root, dir = root) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(root, path) : [relative(root, path)];
  });
}

const a = new Set(files(mine));
const b = new Set(files(theirs));
const problems = [];
for (const f of [...new Set([...a, ...b])].sort()) {
  if (!a.has(f)) problems.push(`only in the sibling: ${f}`);
  else if (!b.has(f)) problems.push(`only here:          ${f}`);
  else if (readFileSync(join(mine, f), 'utf8') !== readFileSync(join(theirs, f), 'utf8')) problems.push(`differs:            ${f}`);
}

if (problems.length) {
  console.error('The shared domain code has drifted between the phone and web repos:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nMake the same change in both repos. For a change that spans both, push a branch');
  console.error('with the same name to each and CI compares the pair.');
  process.exit(1);
}
console.log(`Shared domain code matches (${a.size} files).`);
