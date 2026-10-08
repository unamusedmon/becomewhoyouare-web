import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { HINT_GAP_MS, pickHint, type HintId } from '../domain/hints';
import { useApp } from '../state/AppStateContext';
import { copy } from './copy';
import { colors, fonts, space, themed } from './theme';

/**
 * The hint (if any) this screen should show, out of the ones that make sense on
 * it right now. Once a hint appears it stays until dismissed or used.
 */
export function useHint(eligible: (HintId | false | undefined | null)[]): HintId | undefined {
  const { state, hydrated } = useApp();
  const showing = useRef<HintId | undefined>(undefined);
  const [, wake] = useState(0);
  const ids = eligible.filter(Boolean) as HintId[];
  const id = hydrated ? pickHint(state.hints, ids, Date.now(), showing.current) : undefined;
  showing.current = id;

  // If the only thing holding a hint back is the gap after the last one, look again when it ends.
  const key = ids.join(',');
  useEffect(() => {
    if (id || !hydrated || !state.hints.enabled || !ids.some((h) => !state.hints.seen[h])) return;
    const last = Math.max(0, ...Object.values(state.hints.seen).map((at) => Date.parse(at ?? '') || 0));
    const wait = last + HINT_GAP_MS - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => wake((n) => n + 1), wait + 50);
    return () => clearTimeout(t);
  }, [id, key, hydrated, state.hints]);
  return id;
}

/**
 * A small speech bubble next to the thing it explains. Never covers anything,
 * never blocks a tap; one tap on it (or using the feature) puts it away for good.
 */
export function Hint({ id, caret = 'up', align = 'left', onDismiss }: { id: HintId; caret?: 'up' | 'down'; align?: 'left' | 'right'; onDismiss?: () => void }) {
  const { dispatch } = useApp();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 260, delay: 350, useNativeDriver: true }).start();
  }, [fade]);
  const dismiss = onDismiss ?? (() => dispatch({ type: 'hint_seen', id }));
  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [caret === 'up' ? -4 : 4, 0] }) }] }}>
      {caret === 'up' && <View style={[st.caret, st.caretUp, align === 'right' && st.caretRight]} />}
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={`${copy.hints[id]} ${copy.hintDismiss}`}
        accessibilityLiveRegion="polite"
        style={st.bubble}
      >
        <Text style={st.text}>{copy.hints[id]}</Text>
        <Text style={st.ok}>{copy.hintDismiss}</Text>
      </Pressable>
      {caret === 'down' && <View style={[st.caret, st.caretDown, align === 'right' && st.caretRight]} />}
    </Animated.View>
  );
}

const st = themed(() => ({
  bubble: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderLeftColor: colors.accent, borderLeftWidth: 2,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: space.md,
  },
  text: { flex: 1, color: colors.ink, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  ok: { color: colors.muted, fontFamily: fonts.sans, fontSize: 13 },
  info: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.faint,
    alignItems: 'center', justifyContent: 'center',
  },
  infoOpen: { borderColor: colors.accent },
  infoText: { color: colors.faint, fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 12, lineHeight: 14 },
  infoTextOpen: { color: colors.accent },
  caret: { width: 10, height: 10, backgroundColor: colors.surface, borderColor: colors.line, transform: [{ rotate: '45deg' }], marginLeft: 22, zIndex: 1 },
  caretRight: { marginLeft: 0, alignSelf: 'flex-end', marginRight: 18 },
  caretUp: { marginBottom: -6, borderTopWidth: 1, borderLeftWidth: 1 },
  caretDown: { marginTop: -6, borderBottomWidth: 1, borderRightWidth: 1 },
}));

/*
 * The (i): after a hint has been seen, a small button beside the feature brings
 * it back on request. Asking is the person's choice, so it ignores the
 * one-at-a-time and gap rules and never touches the seen record.
 */
let asked: HintId | undefined;
const listeners = new Set<() => void>();
function setAsked(id: HintId | undefined) {
  asked = id;
  for (const l of listeners) l();
}
function useAsked(): HintId | undefined {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => asked,
    () => undefined,
  );
}

export function InfoButton({ id }: { id: HintId }) {
  const { state } = useApp();
  const open = useAsked() === id;
  if (!state.hints.enabled || !state.hints.seen[id]) return null;
  return (
    <Pressable
      onPress={() => setAsked(open ? undefined : id)}
      hitSlop={14}
      accessibilityRole="button"
      accessibilityLabel={copy.hintInfo}
      accessibilityState={{ expanded: open }}
      style={[st.info, open && st.infoOpen]}
    >
      <Text style={[st.infoText, open && st.infoTextOpen]}>i</Text>
    </Pressable>
  );
}

/** Where a hint appears: on its own the first time, or when its (i) is tapped. */
export function HintSpot({ id, auto, caret, align }: { id: HintId; auto?: HintId; caret?: 'up' | 'down'; align?: 'left' | 'right' }) {
  const open = useAsked() === id;
  useEffect(() => () => { if (asked === id) setAsked(undefined); }, [id]);
  if (auto === id) return <Hint id={id} caret={caret} align={align} />;
  if (open) return <Hint id={id} caret={caret} align={align} onDismiss={() => setAsked(undefined)} />;
  return null;
}
