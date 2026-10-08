/**
 * The Org file as .org.gpg, encrypted to a GPG key the person imports, so Emacs opens
 * it with their own keyring (EasyPG) and nothing readable sits on the server.
 *
 * Import the public key and the app can write the file; import the secret key too and
 * it can read edits made in Emacs back. openpgp.js is loaded only when a key is used.
 */
type OpenPGP = typeof import('openpgp');
let lib: Promise<OpenPGP> | undefined;
const openpgp = () => (lib ??= import('openpgp'));

export interface GpgKey {
  fingerprint: string;
  /** "Zach <zach@example.com>", for showing which key this is. */
  userId: string;
  publicArmored: string;
  /** The secret key, already unlocked. Present only if a secret key was imported. */
  secretArmored?: string;
}

export class GpgError extends Error {}

/** Takes what `gpg --armor --export` or `--export-secret-keys` prints, plus the key's passphrase if it has one. */
export async function importGpgKey(armored: string, passphrase?: string): Promise<GpgKey> {
  const pgp = await openpgp();
  let key;
  try {
    key = await pgp.readKey({ armoredKey: armored.trim() });
  } catch {
    throw new GpgError("That doesn't look like an armored GPG key. Paste the whole block, BEGIN to END.");
  }
  const userId = key.getUserIDs()[0] ?? '';
  const fingerprint = key.getFingerprint().toUpperCase();
  try {
    await key.getEncryptionKey();
  } catch {
    throw new GpgError('This key has no encryption subkey, so nothing can be encrypted to it.');
  }
  if (!key.isPrivate()) return { fingerprint, userId, publicArmored: key.armor() };

  let secret = key as Awaited<ReturnType<OpenPGP['readPrivateKey']>>;
  if (!secret.isDecrypted()) {
    if (!passphrase) throw new GpgError('This secret key is protected. Enter its passphrase too.');
    try {
      secret = await pgp.decryptKey({ privateKey: secret, passphrase });
    } catch {
      throw new GpgError("That passphrase doesn't unlock the key.");
    }
  }
  return { fingerprint, userId, publicArmored: secret.toPublic().armor(), secretArmored: secret.armor() };
}

export async function encryptToKey(text: string, key: GpgKey): Promise<Uint8Array> {
  const pgp = await openpgp();
  const encryptionKeys = await pgp.readKey({ armoredKey: key.publicArmored });
  return pgp.encrypt({ message: await pgp.createMessage({ text }), encryptionKeys, format: 'binary' });
}

/** Binary or armored, as Emacs may write either. Throws GpgError if this key can't open it. */
export async function decryptWithKey(data: Uint8Array, key: GpgKey): Promise<string> {
  if (!key.secretArmored) throw new GpgError('Only the public key is imported, so edits made in Emacs stay there.');
  const pgp = await openpgp();
  const decryptionKeys = await pgp.readPrivateKey({ armoredKey: key.secretArmored });
  const head = new TextDecoder().decode(data.slice(0, 40));
  const message = head.includes('-----BEGIN PGP MESSAGE')
    ? await pgp.readMessage({ armoredMessage: new TextDecoder().decode(data) })
    : await pgp.readMessage({ binaryMessage: data });
  try {
    const { data: text } = await pgp.decrypt({ message, decryptionKeys });
    return text as string;
  } catch {
    throw new GpgError("The .org.gpg file isn't encrypted to the imported key.");
  }
}

/** First line of the file: tells Emacs to encrypt to the same key when it saves. */
export function epaHeader(key: GpgKey): string {
  return `# -*- epa-file-encrypt-to: ("${key.fingerprint}") -*-`;
}
