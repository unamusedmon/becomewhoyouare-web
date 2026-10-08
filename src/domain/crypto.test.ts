/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as openpgp from 'openpgp';

import { deriveKey, fromBase64, newKdf, seal, sealedKdf, toBase64, unseal, WrongKeyError } from './crypto';
import { editsSince, renderOrg } from './org';
import { decryptWithKey, encryptToKey, epaHeader, GpgError, importGpgKey } from './pgp';
import { initialState, reducer, type Action } from './reducer';

test('base64 round-trips every length', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
  }
});

test('the sync file seals with a passphrase and only that passphrase opens it', async () => {
  const kdf = newKdf();
  const key = await deriveKey('correct horse', kdf);
  const sealed = seal('{"secret":"landlord"}', key);
  assert.ok(!sealed.includes('landlord'));
  assert.deepEqual(sealedKdf(sealed), kdf);
  assert.equal(sealedKdf('{"format":"become-who-you-are/sync"}'), undefined);

  // Another device: reads the salt from the file, derives, opens.
  const other = await deriveKey('correct horse', sealedKdf(sealed)!);
  assert.equal(unseal(sealed, other), '{"secret":"landlord"}');

  const wrong = await deriveKey('wrong horse', kdf);
  assert.throws(() => unseal(sealed, wrong), (e: Error) => e instanceof WrongKeyError && e.message === 'tag');
  // Changed elsewhere: a new salt is told apart from a typo.
  const rotated = await deriveKey('correct horse', newKdf());
  assert.throws(() => unseal(sealed, rotated), (e: Error) => e instanceof WrongKeyError && e.message === 'salt');

  // Tampering is caught, not decrypted into garbage.
  const parsed = JSON.parse(sealed);
  const data = fromBase64(parsed.data);
  data[0] ^= 1;
  assert.throws(() => unseal(JSON.stringify({ ...parsed, data: toBase64(data) }), key), WrongKeyError);
});

test('a GPG key encrypts the org file both ways, and Emacs edits still come back', async () => {
  const { privateKey, publicKey } = await openpgp.generateKey({ userIDs: [{ name: 'Zach', email: 'z@example.com' }], passphrase: 'kp', type: 'ecc', format: 'armored' });
  await assert.rejects(importGpgKey(privateKey), GpgError);
  await assert.rejects(importGpgKey(privateKey, 'nope'), GpgError);
  await assert.rejects(importGpgKey('not a key'), GpgError);
  const secret = await importGpgKey(privateKey, 'kp');
  const pub = await importGpgKey(publicKey);
  assert.equal(secret.fingerprint, pub.fingerprint);
  assert.equal(secret.userId, 'Zach <z@example.com>');
  assert.equal(pub.secretArmored, undefined);

  const at = '2026-10-08T09:00:00Z';
  const state = reducer(initialState, { type: 'capture', id: 'a', title: 'Email the landlord', at } as Action);
  const text = `${epaHeader(pub)}\n${renderOrg(state, at)}`;
  assert.match(text, new RegExp(`^# -\\*- epa-file-encrypt-to: \\("${pub.fingerprint}"\\) -\\*-`));

  // Written with only the public key; Emacs edits it; read back with the secret key.
  const file = await encryptToKey(text, pub);
  assert.ok(!new TextDecoder().decode(file).includes('landlord'));
  const edited = (await decryptWithKey(file, secret)).replace('** TODO Email', '** DONE Email');
  const fromEmacs = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: edited }),
    encryptionKeys: await openpgp.readKey({ armoredKey: publicKey }),
    format: 'armored',
  });
  const back = await decryptWithKey(new TextEncoder().encode(fromEmacs as string), secret);
  assert.deepEqual(editsSince(back, { state, writtenAt: at }, state, () => 'x'), [{ type: 'complete', taskId: 'a' }]);

  await assert.rejects(decryptWithKey(file, pub), GpgError);
});
