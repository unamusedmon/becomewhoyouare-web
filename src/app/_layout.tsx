import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { AppStateProvider, useApp } from '../state/AppStateContext';
import { colors } from '../ui/theme';
import { UndoBar } from '../ui/UndoBar';

export default function RootLayout() {
  return (
    <AppStateProvider>
      <Chrome />
    </AppStateProvider>
  );
}

function Chrome() {
  const { theme } = useApp();
  // The page behind the app shows on web overscroll; keep it the same paper as the app.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.body.style.backgroundColor = colors.bg;
  }, [theme.mode]);
  return (
    <>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
        {/* Quick add floats over whatever screen you were on. Also reachable as becomewhoyouare://add. */}
        <Stack.Screen
          name="add"
          options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }}
        />
      </Stack>
      <UndoBar />
    </>
  );
}
