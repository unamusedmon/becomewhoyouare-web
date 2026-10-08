import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useApp } from '../state/AppStateContext';
import { GpgError, importGpgKey } from '../domain/pgp';
import { ORG_FILE, ORG_GPG_FILE } from '../state/sync';
import { Button, s as shared, Toggle } from './components';
import { copy } from './copy';
import { colors, fonts, space, themed } from './theme';

const c = copy.sync;
const k = copy.crypto;

/** Sync between this device and others through a WebDAV folder. The .org mirror is its own switch (OrgSettings). */
export function SyncSettings() {
  const { sync } = useApp();
  const { config, status } = sync;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!config) return;
    setUrl(config.url);
    setUser(config.user);
    setPassword(config.password);
  }, [config]);

  const on = !!config?.enabled;
  const save = () => { void sync.save({ ...config, enabled: true, url: url.trim(), user: user.trim(), password, org: config?.org ?? false }); setOpen(false); };
  const when = status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : undefined;

  return (
    <View style={st.section}>
      <Text style={shared.label}>{c.title}</Text>
      <Text style={shared.faint}>{on ? (status.syncing ? c.syncing : status.error ?? (when ? c.syncedAt(when) : c.waiting)) : c.off}</Text>

      {open ? (
        <View style={st.section}>
          <TextInput value={url} onChangeText={setUrl} placeholder={c.urlPlaceholder} placeholderTextColor={colors.faint}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" style={st.input} accessibilityLabel={c.url} />
          <TextInput value={user} onChangeText={setUser} placeholder={c.user} placeholderTextColor={colors.faint}
            autoCapitalize="none" autoCorrect={false} style={st.input} accessibilityLabel={c.user} />
          <TextInput value={password} onChangeText={setPassword} placeholder={c.password} placeholderTextColor={colors.faint}
            secureTextEntry autoCapitalize="none" autoCorrect={false} style={st.input} accessibilityLabel={c.password} />
          <Text style={shared.faint}>{c.note}</Text>
          <View style={shared.row}>
            <Button kind="primary" label={c.save} onPress={save} />
            <Button label={copy.cancel} onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : (
        <View style={shared.row}>
          {on ? <Button kind="primary" label={c.now} onPress={sync.syncNow} /> : null}
          <Button label={on ? c.edit : c.setUp} onPress={() => setOpen(true)} />
          {on && config ? <Button label={c.stop} onPress={() => { void sync.save({ ...config, enabled: false }); }} /> : null}
        </View>
      )}
    </View>
  );
}

/** Off unless asked for. Needs sync, since the file lives in the same folder. */
export function OrgSettings() {
  const { sync } = useApp();
  const { config } = sync;
  const o = copy.settings;
  const allowed = !!config?.enabled && (!config.key || !!config.gpg);
  const on = allowed && !!config?.org;
  const file = config?.gpg ? ORG_GPG_FILE : ORG_FILE;
  return (
    <View style={st.section}>
      <Text style={shared.label}>{o.org}</Text>
      <Toggle
        label={o.orgSetting(file)}
        value={on}
        disabled={!allowed}
        onChange={(org) => { if (config) void sync.save({ ...config, org }); }}
      />
      <Text style={shared.faint}>{!config?.enabled ? o.orgNeedsSync : !allowed ? o.orgNeedsKey : config.gpg ? o.orgNoteGpg : o.orgNote}</Text>
      {config?.enabled ? <GpgKeySettings /> : null}
    </View>
  );
}

function GpgKeySettings() {
  const { sync } = useApp();
  const { config } = sync;
  const [armored, setArmored] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!config) return null;
  const key = config.gpg;

  const importKey = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const gpg = await importGpgKey(armored, passphrase || undefined);
      await sync.save({ ...config, gpg });
      setArmored('');
      setPassphrase('');
    } catch (e) {
      setError(e instanceof GpgError ? e.message : "Couldn't read that key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={st.section}>
      <Text style={shared.label}>{k.gpgTitle}</Text>
      {key ? (
        <>
          <Text style={st.mono}>{k.gpgKey(key.userId, key.fingerprint.replace(/(.{4})/g, '$1 ').trim())}</Text>
          <Text style={shared.faint}>{key.secretArmored ? k.gpgTwoWay : k.gpgOneWay}</Text>
          <View style={shared.row}>
            <Button label={k.gpgRemove} onPress={() => { void sync.save({ ...config, gpg: undefined, org: config.key ? false : config.org }); }} />
          </View>
        </>
      ) : (
        <>
          <Text style={shared.faint}>{k.gpgNone}</Text>
          <TextInput value={armored} onChangeText={setArmored} placeholder={k.gpgPaste} placeholderTextColor={colors.faint}
            multiline autoCapitalize="none" autoCorrect={false} style={[st.input, st.area]} accessibilityLabel={k.gpgPaste} />
          <TextInput value={passphrase} onChangeText={setPassphrase} placeholder={k.gpgPassphrase} placeholderTextColor={colors.faint}
            secureTextEntry autoCapitalize="none" autoCorrect={false} style={st.input} accessibilityLabel={k.gpgPassphrase} />
          {busy ? <Text style={shared.faint}>{k.gpgWorking}</Text> : null}
          {error ? <Text style={st.error}>{error}</Text> : null}
          <View style={shared.row}>
            <Button kind="primary" label={k.gpgImport} onPress={() => { if (armored.trim() && !busy) void importKey(); }} />
          </View>
        </>
      )}
      <Text style={shared.faint}>{k.gpgStored}</Text>
    </View>
  );
}

/** End-to-end encryption of the sync file with a passphrase. */
export function EncryptionSettings() {
  const { sync } = useApp();
  const { config } = sync;
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'wrong' | 'error'>('idle');
  const enabled = !!config?.enabled;
  const on = enabled && !!config?.key;

  const submit = async (replace = false) => {
    if (!passphrase || state === 'working') return;
    setState('working');
    const result = await sync.setPassphrase(passphrase, { replace });
    setState(result === 'ok' ? 'done' : result);
    if (result === 'ok') { setPassphrase(''); setOpen(false); }
  };

  return (
    <View style={st.section}>
      <Text style={shared.label}>{k.title}</Text>
      <Text style={shared.faint}>{!enabled ? k.needsSync : on ? k.on : k.off}</Text>
      {state === 'done' ? <Text style={shared.faint}>{k.done}</Text> : null}
      {enabled && open ? (
        <>
          <TextInput value={passphrase} onChangeText={setPassphrase} placeholder={k.passphrase} placeholderTextColor={colors.faint}
            secureTextEntry autoCapitalize="none" autoCorrect={false} style={st.input} accessibilityLabel={k.passphrase}
            onSubmitEditing={() => { void submit(); }} />
          <Text style={shared.faint}>{k.passphraseNote}</Text>
          {state === 'working' ? <Text style={shared.faint}>{k.working}</Text> : null}
          {state === 'error' ? <Text style={st.error}>{k.failed}</Text> : null}
          {state === 'wrong' ? (
            <>
              <Text style={st.error}>{k.wrong}</Text>
              <Text style={shared.faint}>{k.replaceNote}</Text>
              <View style={shared.row}><Button label={k.replace} onPress={() => { void submit(true); }} /></View>
            </>
          ) : null}
          <View style={shared.row}>
            <Button kind="primary" label={on ? k.change : k.turnOn} onPress={() => { void submit(); }} />
            <Button label={copy.cancel} onPress={() => { setOpen(false); setState('idle'); }} />
          </View>
        </>
      ) : enabled ? (
        <View style={shared.row}>
          <Button label={on ? k.change : k.turnOn} onPress={() => { setOpen(true); setState('idle'); }} />
        </View>
      ) : null}
    </View>
  );
}

const st = themed(() => ({
  section: { gap: space.md },
  mono: { color: colors.ink, fontFamily: fonts.sans, fontSize: 14 },
  error: { color: colors.accent, fontFamily: fonts.sans, fontSize: 14 },
  area: { minHeight: 110, textAlignVertical: 'top', fontSize: 12 },
  input: {
    color: colors.ink, fontFamily: fonts.sans, fontSize: 16, backgroundColor: colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 11,
  },
}));
