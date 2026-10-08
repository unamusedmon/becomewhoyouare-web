/**
 * End-to-end encryption for the sync file. A passphrase, stretched with scrypt, seals
 * the JSON with AES-256-GCM before it leaves the device; the server only ever holds
 * the sealed envelope. Pure JS (@noble), so the phone and the browser run the same code.
 *
 * The passphrase itself is never stored. Each device keeps the derived key, with the
 * salt it belongs to, so it can tell "wrong passphrase" from "the passphrase changed".
 */
import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes } from '@noble/hashes/utils.js';

export const SEALED_FORMAT = 'become-who-you-are/sync-encrypted';
const AAD = new TextEncoder().encode(`${SEALED_FORMAT}/1`);

export interface KdfParams {
  name: 'scrypt';
  /** CPU and memory cost. 2^16 takes about 64 MB and a second or two on a phone, once per device. */
  N: number;
  r: number;
  p: number;
  salt: string;
}

/** What a device keeps after the passphrase is entered. */
export interface SyncKey {
  kdf: KdfParams;
  key: string;
}

interface Sealed {
  format: typeof SEALED_FORMAT;
  version: 1;
  kdf: KdfParams;
  nonce: string;
  data: string;
}

export class WrongKeyError extends Error {}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function newKdf(): KdfParams {
  return { name: 'scrypt', N: 2 ** 16, r: 8, p: 1, salt: toBase64(randomBytes(16)) };
}

export async function deriveKey(passphrase: string, kdf: KdfParams): Promise<SyncKey> {
  const key = await scryptAsync(passphrase.normalize('NFKC'), fromBase64(kdf.salt), { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32 });
  return { kdf, key: toBase64(key) };
}

/** Is this file sealed? Returns its key parameters, so a device knows which salt to derive with. */
export function sealedKdf(text: string): KdfParams | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<Sealed>;
    return parsed?.format === SEALED_FORMAT && parsed.version === 1 && parsed.kdf ? parsed.kdf : undefined;
  } catch {
    return undefined;
  }
}

export function seal(plain: string, key: SyncKey): string {
  const nonce = randomBytes(12);
  const data = gcm(fromBase64(key.key), nonce, AAD).encrypt(new TextEncoder().encode(plain));
  const sealed: Sealed = { format: SEALED_FORMAT, version: 1, kdf: key.kdf, nonce: toBase64(nonce), data: toBase64(data) };
  return JSON.stringify(sealed);
}

/** Throws WrongKeyError if the key doesn't open it (wrong passphrase, or it was changed elsewhere). */
export function unseal(text: string, key: SyncKey): string {
  const sealed = JSON.parse(text) as Sealed;
  if (sealed.kdf.salt !== key.kdf.salt) throw new WrongKeyError('salt');
  try {
    return new TextDecoder().decode(gcm(fromBase64(key.key), fromBase64(sealed.nonce), AAD).decrypt(fromBase64(sealed.data)));
  } catch {
    throw new WrongKeyError('tag');
  }
}
