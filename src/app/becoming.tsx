import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { LooseCadence } from '../domain/model';
import { firstStepTestResult } from '../domain/experiment';
import { aboutDuration, computeEvidence } from '../domain/overcoming';
import { affirmedShare, CADENCE_ORDER } from '../domain/recurrence';
import { MAX_BECOMINGS } from '../domain/reducer';
import { useApp } from '../state/AppStateContext';
import { newId } from '../state/useAppState';
import { s as shared } from '../ui/components';
import { copy } from '../ui/copy';
import { HintSpot, InfoButton, useHint } from '../ui/Hint';
import { Screen, screenStyles } from '../ui/Screen';
import { colors, fonts, space, themed } from '../ui/theme';

const b = copy.becoming;

/** The long arc: who you're becoming, which routines you'd live again, what you let go. */
export default function BecomingScreen() {
  const { state, dispatch } = useApp();
  const [statement, setStatement] = useState('');
  const [routineTitle, setRoutineTitle] = useState('');
  const [cadence, setCadence] = useState<LooseCadence>('weekly');

  const active = state.becomings.filter((x) => x.status === 'active');
  const routines = state.routines.filter((r) => r.status === 'active');
  const share = affirmedShare(state.routines);
  const evidence = computeEvidence(state.tasks, state.events, new Date().toISOString());
  const test = firstStepTestResult(state.events, state.tasks);
  const testLine = test
    ? aboutDuration(test.withStep.medianSec) === aboutDuration(test.withoutStep.medianSec)
      ? b.testSame(test.withStep.n, test.withoutStep.n)
      : b.testResult(aboutDuration(test.withStep.medianSec), aboutDuration(test.withoutStep.medianSec), test.withStep.n, test.withoutStep.n)
    : undefined;
  const anyAsked = state.routines.some((r) => r.recurrence.standing !== 'unasked');
  // Everything out of sight, newest first. Onboarding's "not now" lands here too, so nothing is ever lost.
  const released = [
    ...state.routines.filter((r) => r.status === 'released').map((r) => ({ key: `r:${r.id}`, title: r.title, tag: b.releasedTag, at: r.updatedAt, back: () => dispatch({ type: 'restore_routine', routineId: r.id }) })),
    ...state.tasks
      .filter((t) => (t.state === 'released' || t.state === 'resting') && !t.routineId)
      .map((t) => ({ key: t.id, title: t.title, tag: t.state === 'resting' ? b.restingTag : b.releasedTag, at: t.updatedAt, back: () => dispatch({ type: 'restore', taskId: t.id }) })),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const hint = useHint([released.length > 0 && 'set_aside']);

  const addBecoming = () => {
    if (!statement.trim()) return;
    dispatch({ type: 'add_becoming', id: newId(), statement });
    setStatement('');
  };
  const addRoutine = () => {
    if (!routineTitle.trim()) return;
    dispatch({ type: 'add_routine', id: newId(), title: routineTitle, cadence });
    setRoutineTitle('');
  };

  return (
    <Screen nav={{ href: '/', label: copy.nowLink }}>
      <View style={st.section}>
        <Text style={screenStyles.h1}>{b.title}</Text>
        {active.length === 0 ? <Text style={screenStyles.body}>{b.empty}</Text> : null}
        {active.map((x) => (
          <View key={x.id} style={st.row}>
            <Text style={st.statement}>{x.statement}</Text>
            <Text style={st.small} onPress={() => dispatch({ type: 'outgrow_becoming', id: x.id })}>{b.outgrow}</Text>
          </View>
        ))}
        {active.length < MAX_BECOMINGS ? (
          <View style={st.addRow}>
            <TextInput
              value={statement}
              onChangeText={setStatement}
              onSubmitEditing={addBecoming}
              placeholder={b.addPlaceholder}
              placeholderTextColor={colors.faint}
              style={st.input}
              accessibilityLabel="Add who you are becoming"
            />
            <Text style={st.addBtn} onPress={addBecoming}>{b.add}</Text>
          </View>
        ) : null}
        <View>
          <Text style={screenStyles.aphorism}>"{b.aphorism.text}"</Text>
          <Text style={shared.faint}>{b.aphorism.source}</Text>
        </View>
      </View>

      {anyAsked && share.total > 0 ? (
        <View style={st.section}>
          <Text style={screenStyles.h2}>{b.authoredTitle}</Text>
          <Text style={screenStyles.body}>{b.authored(share.affirmed, share.total)}</Text>
        </View>
      ) : null}

      <View style={st.section}>
        <Text style={shared.label}>{copy.evidence.section}</Text>
        {evidence.length === 0 ? <Text style={shared.faint}>{copy.evidence.empty}</Text> : null}
        {evidence.map((e) => <Text key={e.key} style={st.evidence}>{e.headline}</Text>)}
        {testLine ? <Text style={st.evidence}>{testLine}</Text> : null}
      </View>

      <View style={st.section}>
        <Text style={shared.label}>{b.routines}</Text>
        {routines.map((r) => (
          <View key={r.id} style={st.routine}>
            <Text style={st.routineTitle}>{r.title}</Text>
            <Text style={shared.faint}>
              {b.cadence[r.cadence]} · {r.nature === 'toll' ? b.tollLabel : b.standing[r.recurrence.standing]}
              {r.becomingIds.length ? ` · ${copy.feeds(state.becomings.find((x) => x.id === r.becomingIds[0])?.statement ?? '')}` : ''}
            </Text>
          </View>
        ))}
        <View style={st.addRow}>
          <TextInput
            value={routineTitle}
            onChangeText={setRoutineTitle}
            onSubmitEditing={addRoutine}
            placeholder={b.routinePlaceholder}
            placeholderTextColor={colors.faint}
            style={st.input}
            accessibilityLabel="Add a routine"
          />
          <Text style={st.addBtn} onPress={addRoutine}>{b.add}</Text>
        </View>
        <View style={shared.row}>
          {CADENCE_ORDER.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityState={{ selected: cadence === c }}
              onPress={() => setCadence(c)}
              style={[shared.chip, cadence === c && shared.chipOn]}
            >
              <Text style={[shared.chipText, cadence === c && shared.chipTextOn]}>{b.cadence[c]}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={st.section}>
        <View style={st.labelRow}>
          <Text style={shared.label}>{b.released}</Text>
          <InfoButton id="set_aside" />
        </View>
        <HintSpot id="set_aside" auto={hint} caret="up" />
        {released.length === 0 ? (
          <Text style={shared.faint}>{b.releasedEmpty}</Text>
        ) : (
          <>
            <Text style={shared.faint}>{b.releasedNote}</Text>
            {released.map((r) => (
              <View key={r.key} style={st.row}>
                <View style={{ flex: 1 }}>
                  <Text style={st.released}>{r.title}</Text>
                  <Text style={shared.faint}>{r.tag}</Text>
                </View>
                <Text style={st.bringBack} onPress={r.back} accessibilityRole="button" accessibilityLabel={`${b.bringBack}: ${r.title}`}>{b.bringBack}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      <Link href="/settings" style={st.settingsLink} accessibilityRole="link">{copy.settings.link}</Link>
    </Screen>
  );
}

const st = themed(() => ({
  section: { gap: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  statement: { flex: 1, color: colors.ink, fontFamily: fonts.serif, fontSize: 20, fontStyle: 'italic' },
  small: { color: colors.faint, fontFamily: fonts.sans, fontSize: 12 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: {
    flex: 1, color: colors.ink, fontFamily: fonts.sans, fontSize: 16, backgroundColor: colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 11,
  },
  addBtn: { color: colors.accent, fontFamily: fonts.sans, fontSize: 15 },
  routine: { gap: 2, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  routineTitle: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16 },
  evidence: { color: colors.ink, fontFamily: fonts.serif, fontSize: 17, lineHeight: 25 },
  released: { color: colors.muted, fontFamily: fonts.serif, fontSize: 15, fontStyle: 'italic' },
  bringBack: { color: colors.accent, fontFamily: fonts.sans, fontSize: 14, paddingVertical: 8, paddingLeft: 12 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  settingsLink: { color: colors.muted, fontFamily: fonts.sans, fontSize: 15, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
}));
