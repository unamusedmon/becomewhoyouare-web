import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '../state/AppStateContext';
import { newId } from '../state/useAppState';
import { CaptureBar } from '../ui/components';
import { copy } from '../ui/copy';
import { colors, fonts, space, themed } from '../ui/theme';

/**
 * Quick add: one field, from anywhere, then straight back to what you were doing.
 * Stays open after each capture so a burst of thoughts can go in one after another.
 */
export default function QuickAdd() {
  const { dispatch } = useApp();
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(0);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <KeyboardAvoidingView style={st.root} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={copy.quickAdd.close} />
      <View style={[st.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={st.head}>
          <Text style={st.title}>{copy.quickAdd.title}</Text>
          <Text style={st.done} onPress={close} accessibilityRole="button">{count ? copy.quickAdd.done : copy.cancel}</Text>
        </View>
        <CaptureBar
          autoFocus
          onCapture={(title, via) => {
            dispatch({ type: 'capture', id: newId(), title, via });
            setCount((n) => n + 1);
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const st = themed(() => ({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: colors.line,
    padding: space.md, gap: space.sm, width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: 20 },
  done: { color: colors.muted, fontFamily: fonts.sans, fontSize: 15, padding: space.xs },
}));
