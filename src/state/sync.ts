/**
 * WebDAV sync, for the phone and the web version alike. One JSON file holds the
 * synced state, sealed with a passphrase when encryption is on (src/domain/crypto.ts).
 * An optional Org file mirrors it for Emacs or Orgzly, as .org.gpg when a GPG key is
 * imported (src/domain/pgp.ts), and edits made there come back in (src/domain/org.ts).
 * Merging rules: src/domain/sync.ts.
 *
 * Credentials live on this device only (AsyncStorage on Android, localStorage on the
 * web) and are never part of the synced state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';

import { deriveKey, newKdf, sealedKdf, seal, unseal, WrongKeyError, type SyncKey } from '../domain/crypto';
import { editsSince, renderOrg } from '../domain/org';
import { decryptWithKey, encryptToKey, epaHeader, GpgError, type GpgKey } from '../domain/pgp';
import { reducer, type Action, type AppState } from '../domain/reducer';
import { mergeStates, parseRemote, toRemote } from '../domain/sync';
import { davDelete, davGet, davPut, type DavConfig } from './webdav';
import { newId, type Dispatch } from './useAppState';

export const DATA_FILE = 'become-who-you-are.json';
export const ORG_FILE = 'become-who-you-are.org';
export const ORG_GPG_FILE = 'become-who-you-are.org.gpg';
const CONFIG_KEY = 'bwya/sync/v1';

/** After a change, wait this long for more before syncing. */
const DEBOUNCE_MS = 15_000;
/** While the app is open, check for the other device's changes this often. */
const POLL_MS = 5 * 60_000;

export interface SyncConfig extends DavConfig {
  enabled: boolean;
  org: boolean;
  /** End-to-end encryption: the key derived from the passphrase. The passphrase isn't kept. */
  key?: SyncKey;
  /** With a GPG key, the Org file is written as .org.gpg, encrypted to it. */
  gpg?: GpgKey;
}

export interface SyncStatus {
  syncing: boolean;
  lastSyncedAt?: string;
  error?: string;
}

export type PassphraseResult = 'ok' | 'wrong' | 'error';

export interface SyncControls {
  config?: SyncConfig;
  status: SyncStatus;
  save: (config: SyncConfig) => Promise<void>;
  syncNow: () => void;
  /**
   * Turn on encryption, join a folder another device encrypted, or change the passphrase.
   * `replace` discards what's on the server (for a lost passphrase) and writes this device's data.
   */
  setPassphrase: (passphrase: string, opts?: { replace?: boolean }) => Promise<PassphraseResult>;
}

class SyncError extends Error {}

function explain(status: number): string {
  if (status === 401 || status === 403) return 'The server said no to that username or password.';
  if (status === 404 || status === 409) return "That folder doesn't exist on the server. Create it first.";
  return `The server answered ${status}.`;
}

/** Plaintext Org files are removed once per session after encryption or a GPG key is turned on. */
const cleaned = new Set<string>();

interface Round {
  /** Read the server's file with this key instead of the configured one (changing the passphrase). */
  readKey?: SyncKey;
  /** Don't read the server's data at all, just replace it (lost passphrase). */
  replace?: boolean;
}

/** One full round: read, merge, apply Org edits, write back. Returns the state that was written. */
export async function syncOnce(cfg: SyncConfig, local: AppState, round: Round = {}): Promise<AppState> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await davGet(cfg, DATA_FILE);
    if (got.status !== 200 && got.status !== 404) throw new SyncError(explain(got.status));
    const exists = got.status === 200 && !!got.text;
    const remote = exists && !round.replace ? readRemote(got.text!, round.readKey ?? cfg.key) : undefined;

    const now = new Date().toISOString();
    let merged = remote ? mergeStates(local, remote.state) : local;

    if (cfg.org && remote) {
      const text = await readOrg(cfg);
      if (text !== undefined) {
        const edits = editsSince(text, remote, merged, newId);
        merged = edits.reduce((s, a) => reducer(s, { ...a, at: now } as Action), merged);
      }
    }

    const json = JSON.stringify(toRemote(merged, now));
    const put = await davPut(cfg, DATA_FILE, cfg.key ? seal(json, cfg.key) : json, 'application/json',
      exists ? { ifMatch: got.etag } : { create: true });
    // Someone else wrote in between: read their version and go again.
    if (put.status === 412 && attempt === 0) { local = merged; continue; }
    if (put.status < 200 || put.status >= 300) throw new SyncError(explain(put.status));

    await writeOrg(cfg, merged, now);
    return merged;
  }
  throw new SyncError('Another device kept writing at the same moment. Try again.');
}

function readRemote(text: string, key: SyncKey | undefined) {
  let plain = text;
  if (sealedKdf(text)) {
    if (!key) throw new SyncError('The synced data is encrypted. Enter the passphrase under Encryption.');
    try {
      plain = unseal(text, key);
    } catch (e) {
      if (!(e instanceof WrongKeyError)) throw e;
      throw new SyncError(e.message === 'salt'
        ? 'The passphrase was changed on another device. Enter the new one under Encryption.'
        : "This device's passphrase doesn't open the synced data. Enter it again under Encryption.");
    }
  }
  const remote = parseRemote(plain);
  if (!remote) throw new SyncError(`${DATA_FILE} on the server isn't a file this app wrote.`);
  return remote;
}

/** The Org file as the person may have edited it, or undefined if there's nothing this device can read. */
async function readOrg(cfg: SyncConfig): Promise<string | undefined> {
  if (cfg.gpg) {
    if (!cfg.gpg.secretArmored) return undefined; // public key only: write-only
    const got = await davGet(cfg, ORG_GPG_FILE, { binary: true });
    if (got.status !== 200 || !got.bytes) return undefined;
    try {
      return await decryptWithKey(got.bytes, cfg.gpg);
    } catch (e) {
      if (e instanceof GpgError) return undefined; // encrypted to another key; the next write fixes it
      throw e;
    }
  }
  if (cfg.key) return undefined; // never read or write plaintext Org while encrypted
  const got = await davGet(cfg, ORG_FILE);
  return got.status === 200 ? got.text : undefined;
}

async function writeOrg(cfg: SyncConfig, state: AppState, now: string): Promise<void> {
  if ((cfg.key || cfg.gpg) && !cleaned.has(cfg.url)) {
    const gone = await davDelete(cfg, ORG_FILE);
    if (gone.status < 300 || gone.status === 404) cleaned.add(cfg.url);
  }
  if (!cfg.org) return;
  let wrote;
  if (cfg.gpg) {
    const text = `${epaHeader(cfg.gpg)}\n${renderOrg(state, now)}`;
    wrote = await davPut(cfg, ORG_GPG_FILE, await encryptToKey(text, cfg.gpg), 'application/pgp-encrypted');
  } else if (!cfg.key) {
    wrote = await davPut(cfg, ORG_FILE, renderOrg(state, now), 'text/plain; charset=utf-8');
  } else {
    return;
  }
  if (wrote.status < 200 || wrote.status >= 300) throw new SyncError(`Synced, but the Org file couldn't be written: ${explain(wrote.status)}`);
}

/** Keeps this device in sync while the app is open. */
export function useSync(state: AppState, hydrated: boolean, dispatch: Dispatch): SyncControls {
  const [config, setConfig] = useState<SyncConfig | undefined>();
  const [status, setStatus] = useState<SyncStatus>({ syncing: false });
  const stateRef = useRef(state);
  stateRef.current = state;
  const running = useRef(false);
  const syncedChange = useRef<string | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(CONFIG_KEY)
      .then((json) => { if (json) setConfig(JSON.parse(json) as SyncConfig); })
      .catch(() => undefined);
  }, []);

  const run = useCallback(async (cfg: SyncConfig | undefined, round?: Round): Promise<boolean> => {
    if (!cfg?.enabled || !cfg.url || running.current) return false;
    running.current = true;
    setStatus((s) => ({ ...s, syncing: true }));
    try {
      const written = await syncOnce(cfg, stateRef.current, round);
      dispatch({ type: 'sync_merge', remote: written });
      syncedChange.current = written.changedAt;
      setStatus({ syncing: false, lastSyncedAt: new Date().toISOString() });
      return true;
    } catch (e) {
      setStatus((s) => ({ ...s, syncing: false, error: messageFor(e) }));
      return false;
    } finally {
      running.current = false;
    }
  }, [dispatch]);

  // On start, on return to the app, and now and then while open.
  useEffect(() => {
    if (!hydrated || !config?.enabled) return;
    void run(config);
    const timer = setInterval(() => void run(config), POLL_MS);
    const sub = RNAppState.addEventListener('change', (s) => { if (s === 'active') void run(config); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [hydrated, config, run]);

  // A little while after something changes here.
  useEffect(() => {
    if (!hydrated || !config?.enabled || !state.changedAt || state.changedAt === syncedChange.current) return;
    const timer = setTimeout(() => void run(config), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hydrated, config, state.changedAt, run]);

  const save = useCallback(async (next: SyncConfig) => {
    setConfig(next);
    setStatus({ syncing: false });
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next)).catch(() => undefined);
    if (next.enabled) void run(next);
  }, [run]);

  const syncNow = useCallback(() => void run(config), [run, config]);

  const setPassphrase = useCallback(async (passphrase: string, opts: { replace?: boolean } = {}): Promise<PassphraseResult> => {
    if (!config?.enabled) return 'error';
    setStatus((s) => ({ ...s, syncing: true, error: undefined }));
    try {
      const got = await davGet(config, DATA_FILE);
      if (got.status !== 200 && got.status !== 404) throw new SyncError(explain(got.status));
      const onServer = got.status === 200 ? got.text : undefined;
      const kdf = onServer ? sealedKdf(onServer) : undefined;
      const opens = (key: SyncKey) => { try { unseal(onServer!, key); return true; } catch { return false; } };

      let next: SyncConfig;
      let round: Round = {};
      if (opts.replace) {
        next = { ...config, key: await deriveKey(passphrase, newKdf()) };
        round = { replace: true };
      } else if (kdf) {
        const key = await deriveKey(passphrase, kdf);
        if (opens(key)) {
          next = { ...config, key };
        } else if (config.key && opens(config.key)) {
          // This device holds the current key, so a different passphrase means "change it".
          next = { ...config, key: await deriveKey(passphrase, newKdf()) };
          round = { readKey: config.key };
        } else {
          setStatus((s) => ({ ...s, syncing: false }));
          return 'wrong';
        }
      } else {
        next = { ...config, key: await deriveKey(passphrase, newKdf()) };
      }
      setStatus((s) => ({ ...s, syncing: false }));
      if (!(await run(next, round))) return 'error';
      setConfig(next);
      await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next)).catch(() => undefined);
      return 'ok';
    } catch (e) {
      setStatus((s) => ({ ...s, syncing: false, error: messageFor(e) }));
      return 'error';
    }
  }, [config, run]);

  return { config, status, save, syncNow, setPassphrase };
}

function messageFor(e: unknown): string {
  return e instanceof SyncError ? e.message : "Couldn't reach the server. It'll try again later.";
}
