import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { EnergyLevel, Task } from '../domain/model';
import { splitSpoken } from '../domain/spoken';
import { useApp } from '../state/AppStateContext';
import { InfoButton } from './Hint';
import { type Dictation, useDictation } from '../state/voice';
import { copy } from './copy';
import { colors, fonts, space, themed } from './theme';

/** A setting: its label on the left, a switch on the right. */
export function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  // The web Switch colors its thumb separately when on; without this it's a stock teal.
  const web = Platform.OS === 'web' ? { activeThumbColor: colors.ink } : {};
  return (
    <View style={s.toggle}>
      <Text style={s.toggleText}>{label}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.line }}
        thumbColor={colors.ink}
        accessibilityLabel={label}
        {...web}
      />
    </View>
  );
}

export function Button({ label, onPress, kind = 'quiet', wide }: { label: string; onPress: () => void; kind?: 'primary' | 'quiet'; wide?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{ color: kind === 'primary' ? colors.accentPressed : colors.line }}
      style={({ pressed }) => [kind === 'primary' ? s.primary : s.quiet, wide && s.wide, pressed && Platform.OS !== 'android' && { opacity: 0.7 }]}
    >
      <Text style={kind === 'primary' ? s.primaryText : s.quietText}>{label}</Text>
    </Pressable>
  );
}

/** Android's back button closes whatever is open (an editor, a step) before it leaves the screen. */
export function useBackToClose(active: boolean, close: () => void) {
  useEffect(() => {
    if (!active || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [active, close]);
}

const LEVELS: EnergyLevel[] = ['high', 'medium', 'low', 'fried'];

export function EnergyBar({ value, onChange }: { value?: EnergyLevel; onChange: (v: EnergyLevel | undefined) => void }) {
  const [open, setOpen] = useState(false);
  // Once answered, the question shrinks to one quiet line so the task gets the attention.
  if (value && !open) {
    return (
      <View style={s.labelRow}>
        <Text style={s.faint}>
          {copy.energyNow(copy.energyLabels[value])}{'  '}
          <Text style={s.inlineLink} onPress={() => setOpen(true)} accessibilityRole="button">{copy.change}</Text>
        </Text>
        <InfoButton id="energy" />
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <View style={s.labelRow}>
        <Text style={s.label}>{copy.energyQuestion}</Text>
        <InfoButton id="energy" />
      </View>
      <View style={s.row}>
        {LEVELS.map((lvl) => {
          const on = value === lvl;
          return (
            <Pressable
              key={lvl}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => { onChange(on ? undefined : lvl); setOpen(false); }}
              style={[s.chip, on && s.chipOn]}
            >
              <Text style={[s.chipText, on && s.chipTextOn]}>{copy.energyLabels[lvl]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A mic drawn from shapes, so it matches the type and needs no icon font. */
function MicGlyph({ color }: { color: string }) {
  return (
    <View style={{ alignItems: 'center' }} importantForAccessibility="no-hide-descendants">
      <View style={{ width: 9, height: 14, borderRadius: 5, backgroundColor: color }} />
      <View style={{ width: 15, height: 8, marginTop: -4, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 2, borderTopWidth: 0, borderColor: color }} />
      <View style={{ width: 2, height: 4, backgroundColor: color }} />
    </View>
  );
}

/** Square mic button that glows while it listens. */
export function MicButton({ listening, onPress, size = 46 }: { listening: boolean; onPress: () => void; size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!listening) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => { loop.stop(); pulse.setValue(0); };
  }, [listening, pulse]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? copy.voiceStop : copy.voiceStart}
      accessibilityState={{ selected: listening }}
      onPress={onPress}
      style={[s.addBtn, { width: size, height: size }, listening && s.micOn]}
    >
      {listening && <Animated.View style={[StyleSheet.absoluteFill, s.micRing, { opacity: pulse }]} />}
      <MicGlyph color={listening ? colors.bg : colors.accent} />
    </Pressable>
  );
}

/**
 * Mic behaviour shared by every capture surface: real dictation when the phone
 * has it, otherwise focus the field and point at the keyboard's own mic.
 */
export function useMic(dictation: Dictation, input: RefObject<TextInput | null>, say: (note: string) => void) {
  return async () => {
    if (dictation.listening) return dictation.stop();
    if (dictation.available && (await dictation.start())) return;
    input.current?.focus();
    say(copy.voiceKeyboard);
  };
}

export function CaptureBar({ onCapture, autoFocus }: { onCapture: (title: string, via?: 'voice') => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3200);
    return () => clearTimeout(t);
  }, [note]);
  const dictation = useDictation((said) => {
    const titles = splitSpoken(said);
    for (const t of titles) onCapture(t, 'voice');
    setNote(titles.length ? copy.voiceCaught(titles.length) : copy.voiceMissed);
  });
  const submit = () => {
    if (!text.trim()) return;
    onCapture(text);
    setText('');
    setNote(copy.captured);
  };
  const micTap = useMic(dictation, input, setNote);
  const { dispatch } = useApp();
  const mic = () => { dispatch({ type: 'hint_seen', id: 'mic' }); return micTap(); };
  return (
    <View style={{ gap: space.xs }}>
      <View style={s.captureRow}>
        <TextInput
          ref={input}
          autoFocus={autoFocus}
          // Keep the keyboard up after adding, so a burst of thoughts can go in one after another.
          submitBehavior="submit"
          {...(Platform.OS === 'web' ? ({ blurOnSubmit: false } as object) : null)}
          value={dictation.listening ? dictation.heard : text}
          onChangeText={setText}
          onSubmitEditing={submit}
          editable={!dictation.listening}
          placeholder={dictation.listening ? copy.voiceListening : copy.capturePlaceholder}
          placeholderTextColor={dictation.listening ? colors.accent : colors.faint}
          returnKeyType="done"
          style={s.captureInput}
          accessibilityLabel="Capture a task"
        />
        {text.trim() && !dictation.listening ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Add" onPress={submit} style={s.addBtn}>
            <Text style={s.addText}>+</Text>
          </Pressable>
        ) : (
          <MicButton listening={dictation.listening} onPress={mic} />
        )}
      </View>
      <View style={s.labelRow}>
        <Text style={[s.faint, { minHeight: 16, flex: 1 }]}>{note ?? (dictation.listening ? copy.voiceTapToStop : ' ')}</Text>
        <InfoButton id="mic" />
      </View>
    </View>
  );
}

/** Edit a task's title in place. Shared by the Now card and the list. */
export function RenameField({ title, onSave, onCancel }: { title: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(title);
  useBackToClose(true, onCancel);
  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => onSave(draft)}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        style={s.captureInput}
        accessibilityLabel="Task name"
      />
      <View style={s.row}>
        <Button kind="primary" label={copy.save} onPress={() => onSave(draft)} />
        <Button label={copy.cancel} onPress={onCancel} />
      </View>
    </View>
  );
}

type RowMode = 'closed' | 'open' | 'renaming';

/** Tapping a task opens its choices instead of silently doing one of them. */
function TaskRow({ task, onPick, onRename, onRelease }: {
  task: Task; onPick: () => void; onRename: (t: string) => void; onRelease: () => void;
}) {
  const [mode, setMode] = useState<RowMode>('closed');
  const close = useCallback(() => setMode('closed'), []);
  useBackToClose(mode === 'open', close);
  return (
    <View style={[s.listItem, mode !== 'closed' && s.listItemOpen]}>
      {mode === 'renaming' ? (
        <RenameField title={task.title} onCancel={close} onSave={(t) => { onRename(t); close(); }} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: mode === 'open' }}
          accessibilityHint={copy.rowHint}
          onPress={() => setMode(mode === 'open' ? 'closed' : 'open')}
          style={{ gap: 2 }}
        >
          <Text style={s.listTitle} numberOfLines={mode === 'open' ? undefined : 1}>{task.title}</Text>
          <Text style={s.faint} numberOfLines={1}>
            {task.state === 'started' ? 'started · ' : ''}{task.duration.experiential.label}
          </Text>
        </Pressable>
      )}
      {mode === 'open' && (
        <View style={[s.row, { marginTop: space.sm }]}>
          <Button kind="primary" label={copy.doNow} onPress={() => { close(); onPick(); }} />
          <Button label={copy.rename} onPress={() => setMode('renaming')} />
          <Button label={copy.letGo} onPress={() => { close(); onRelease(); }} />
        </View>
      )}
    </View>
  );
}

export function AlsoHere({ tasks, onPick, onRename, onRelease }: {
  tasks: Task[];
  onPick: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRelease: (id: string) => void;
}) {
  if (!tasks.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <View style={s.labelRow}>
        <Text style={s.label}>{copy.alsoHere}</Text>
        <InfoButton id="also_here" />
      </View>
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          onPick={() => onPick(t.id)}
          onRename={(title) => onRename(t.id, title)}
          onRelease={() => onRelease(t.id)}
        />
      ))}
    </View>
  );
}

export interface Flash {
  key: number;
  text: string;
  sub?: string;
}

/** The vivid completion signal: fast, bright, gone in under a second and a half. */
export function WinFlash({ flash }: { flash: Flash | null }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!flash) return;
    anim.setValue(0);
    Animated.sequence([
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 12 }),
      Animated.delay(650),
      Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [flash?.key]);
  if (!flash) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[s.flash, { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}
    >
      <Text style={s.flashText}>{flash.text}</Text>
      {flash.sub ? <Text style={s.flashSub}>{flash.sub}</Text> : null}
    </Animated.View>
  );
}

export const s = themed(() => ({
  toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  toggleText: { flex: 1, color: colors.muted, fontFamily: fonts.sans, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  label: { color: colors.muted, fontFamily: fonts.sans, fontSize: 13, letterSpacing: 0.3 },
  faint: { color: colors.faint, fontFamily: fonts.sans, fontSize: 13 },
  inlineLink: { color: colors.muted, textDecorationLine: 'underline' },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.muted, fontFamily: fonts.sans, fontSize: 14 },
  chipTextOn: { color: colors.accent },
  primary: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 13, overflow: 'hidden' },
  wide: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 16 },
  primaryText: { color: colors.onAccent, fontFamily: fonts.sans, fontSize: 16, fontWeight: '600' },
  quiet: { paddingHorizontal: 10, paddingVertical: 13, borderRadius: 10, overflow: 'hidden' },
  quietText: { color: colors.muted, fontFamily: fonts.sans, fontSize: 15 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  captureRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  captureInput: {
    flex: 1, color: colors.ink, fontFamily: fonts.sans, fontSize: 16, backgroundColor: colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12,
  },
  addBtn: { width: 46, height: 46, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  addText: { color: colors.accent, fontSize: 24, lineHeight: 26 },
  micOn: { backgroundColor: colors.accent, borderColor: colors.accent, overflow: 'hidden' },
  micRing: { backgroundColor: colors.mic },
  listItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, gap: 2 },
  listItemOpen: { backgroundColor: colors.surface, marginHorizontal: -space.sm, paddingHorizontal: space.sm, borderRadius: 10 },
  listTitle: { color: colors.ink, fontFamily: fonts.sans, fontSize: 15 },
  flash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.scrimStrong },
  flashText: { color: colors.win, fontFamily: fonts.serif, fontSize: 56 },
  flashSub: { color: colors.ink, fontFamily: fonts.serif, fontSize: 18, marginTop: space.sm, fontStyle: 'italic' },
}));
