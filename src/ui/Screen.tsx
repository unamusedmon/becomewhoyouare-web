import { Link, router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isFresh } from '../domain/undo';
import { useApp } from '../state/AppStateContext';
import { copy } from './copy';
import { colors, fonts, space, themed } from './theme';

/** Shared page frame: dark, one column, readable width on web. */
export function Screen({ children, nav }: { children: ReactNode; nav?: { href: '/' | '/becoming' | '/settings'; label: string } }) {
  // Android draws edge to edge (SDK 54+), so the status bar, gesture bar and keyboard are ours to avoid.
  const insets = useSafeAreaInsets();
  const { undo } = useApp();
  const path = usePathname();
  // The Undo bar takes the bottom edge for a few seconds; the add button steps up out of its way.
  const lift = isFresh(undo, Date.now()) ? 64 : 0;
  return (
    <View style={st.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <ScrollView
          contentContainerStyle={[st.scroll, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl + 56 }]}
          keyboardShouldPersistTaps="handled"
        >
          {nav ? (
            <View style={st.top}>
              <Text style={st.brand}>Become Who You Are</Text>
              <View style={st.links}>
                <Link href={nav.href} style={st.nav}>{nav.label}</Link>
                {path === '/settings' ? null : <Link href="/settings" style={st.nav}>{copy.settings.link}</Link>}
              </View>
            </View>
          ) : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Main screens get a quick-add button that stays put while you scroll. */}
      {nav ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.quickAdd.button}
          onPress={() => router.push('/add')}
          android_ripple={{ color: colors.line, borderless: true }}
          style={({ pressed }) => [st.fab, { bottom: insets.bottom + space.md + lift }, pressed && Platform.OS !== 'android' && { opacity: 0.8 }]}
        >
          <Text style={st.fabText}>+</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const screenStyles = themed(() => ({
  h1: { color: colors.ink, fontFamily: fonts.serif, fontSize: 30, lineHeight: 38 },
  h2: { color: colors.ink, fontFamily: fonts.serif, fontSize: 22, lineHeight: 29 },
  body: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23, opacity: 0.85 },
  aphorism: { color: colors.muted, fontFamily: fonts.serif, fontSize: 16, fontStyle: 'italic', lineHeight: 23, marginBottom: space.xs },
}));

const st = themed(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.md, gap: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  brand: { color: colors.faint, fontFamily: fonts.serif, fontSize: 15, letterSpacing: 1, fontStyle: 'italic' },
  links: { flexDirection: 'row', gap: space.md },
  nav: { color: colors.muted, fontFamily: fonts.sans, fontSize: 15 },
  fab: {
    // Quiet on purpose: gold fill belongs to the Now card's one big button.
    position: 'absolute', right: space.md, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', elevation: 4,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: colors.accent, fontSize: 30, lineHeight: 32, fontWeight: '500' },
}));
