import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { firstStepTestProgress, firstStepTestResult } from '../domain/experiment';
import { useApp } from '../state/AppStateContext';
import { s as shared, Toggle } from '../ui/components';
import { copy } from '../ui/copy';
import { Screen, screenStyles } from '../ui/Screen';
import { EncryptionSettings, OrgSettings, SyncSettings } from '../ui/SyncSettings';
import { colors, fonts, space, themed } from '../ui/theme';

const b = copy.becoming;
const o = copy.settings;

/** Everything that changes how the app behaves, rather than what's in it. */
export default function SettingsScreen() {
  const { state, dispatch, theme } = useApp();
  const [hintsReset, setHintsReset] = useState(false);

  const test = firstStepTestResult(state.events, state.tasks);
  const testProgress = firstStepTestProgress(state.events);

  return (
    <Screen nav={{ href: '/becoming', label: copy.becomingLink }}>
      <Text style={screenStyles.h1}>{o.title}</Text>

      <SyncSettings />
      <View style={st.setting}><EncryptionSettings /></View>
      <View style={st.setting}><OrgSettings /></View>

      <View style={[st.section, st.setting]}>
        <Text style={shared.label}>{o.appearance}</Text>
        <Toggle label={o.lightSetting} value={theme.mode === 'light'} onChange={(on) => theme.setMode(on ? 'light' : 'dark')} />
        <Text style={shared.faint}>{o.lightNote}</Text>
      </View>

      <View style={[st.section, st.setting]}>
        <Text style={shared.label}>{o.guidance}</Text>
        <Toggle label={b.hintsSetting} value={state.hints.enabled} onChange={(enabled) => dispatch({ type: 'set_hints', enabled })} />
        {state.hints.enabled && Object.keys(state.hints.seen).length > 0 ? (
          <Text style={st.resetHints} onPress={() => { dispatch({ type: 'reset_hints' }); setHintsReset(true); }} accessibilityRole="button">
            {hintsReset ? b.hintsResetDone : b.hintsReset}
          </Text>
        ) : hintsReset ? <Text style={st.resetHints}>{b.hintsResetDone}</Text> : null}
        <Toggle label={b.recurrenceSetting} value={state.recurrence.enabled} onChange={(enabled) => dispatch({ type: 'set_recurrence_enabled', enabled })} />
      </View>

      <View style={[st.section, st.setting]}>
        <Text style={shared.label}>{o.experiments}</Text>
        <Toggle label={b.testSetting} value={state.experiments.firstStepTest} onChange={(enabled) => dispatch({ type: 'set_first_step_test', enabled })} />
        {state.experiments.firstStepTest ? (
          <Text style={shared.faint}>{b.testNote} {!test ? b.testProgress(testProgress.started, testProgress.needed) : ''}</Text>
        ) : null}
      </View>
    </Screen>
  );
}

const st = themed(() => ({
  section: { gap: space.md },
  setting: { paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  settingText: { flex: 1, color: colors.muted, fontFamily: fonts.sans, fontSize: 14 },
  resetHints: { color: colors.muted, fontFamily: fonts.sans, fontSize: 13, textDecorationLine: 'underline', marginTop: -space.sm },
}));
