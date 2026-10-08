import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useApp } from '../state/AppStateContext';
import { newId } from '../state/useAppState';
import { splitSpoken } from '../domain/spoken';
import { useDictation } from '../state/voice';
import { Button, MicButton, s as shared, useBackToClose, useMic } from '../ui/components';
import { copy } from '../ui/copy';
import { Screen, screenStyles } from '../ui/Screen';
import { colors, fonts, space, themed } from '../ui/theme';

const o = copy.onboarding;

type Step = 'camel' | 'lion' | 'child' | 'amor' | 'optin';
const STEPS: Step[] = ['camel', 'lion', 'child', 'amor', 'optin'];
type Choice = 'keep' | 'not_mine' | 'not_now';

/**
 * Loosely Zarathustra's three metamorphoses: the camel unloads "thou shalt",
 * the lion says "I will", the child says yes. Never explained, only felt.
 */
export default function Onboarding() {
  const { state, dispatch } = useApp();
  const [step, setStep] = useState<Step>('camel');
  const [dump, setDump] = useState('');
  const [captured, setCaptured] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [becoming, setBecoming] = useState('');

  const [voiced, setVoiced] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState<string | null>(null);
  const dumpInput = useRef<TextInput>(null);
  // Spoken items land in the dump one per line, so they can be fixed before moving on.
  const dictation = useDictation((said) => {
    const lines = splitSpoken(said);
    if (!lines.length) return setHint(copy.voiceMissed);
    setHint(null);
    setVoiced((v) => new Set([...v, ...lines]));
    setDump((d) => [d.trimEnd(), ...lines].filter(Boolean).join('\n'));
  });
  const mic = useMic(dictation, dumpInput, setHint);

  const go = (next: Step) => {
    if (dictation.listening) dictation.stop();
    setStep(next);
  };
  // Back steps through the metamorphoses instead of leaving the app. The lion only exists if there was a dump.
  const back = useCallback(() => {
    const prev = STEPS[STEPS.indexOf(step) - 1];
    setStep(prev === 'lion' && !captured.length ? 'camel' : prev);
  }, [step, captured.length]);
  useBackToClose(step !== 'camel', back);

  const finishCamel = () => {
    const ids = dump
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((title) => {
        const id = newId() + Math.random().toString(36).slice(2, 5);
        dispatch({ type: 'capture', id, title, via: voiced.has(title) ? 'voice' : undefined });
        return id;
      });
    setCaptured(ids);
    go(ids.length ? 'lion' : 'child');
  };

  const finishLion = () => {
    for (const id of captured) {
      if (choices[id] === 'not_mine') dispatch({ type: 'release', taskId: id });
      if (choices[id] === 'not_now') dispatch({ type: 'rest', taskId: id });
    }
    go('child');
  };

  const finish = (optIn: boolean) => {
    dispatch({ type: 'set_recurrence_enabled', enabled: optIn });
    dispatch({ type: 'complete_onboarding' });
    router.replace('/');
  };

  const lionTasks = state.tasks.filter((t) => captured.includes(t.id));

  return (
    <Screen>
      <View style={st.dots} accessibilityLabel={`Step ${STEPS.indexOf(step) + 1} of ${STEPS.length}`}>
        {STEPS.map((s) => <View key={s} style={[st.dot, s === step && st.dotOn]} />)}
      </View>

      {step === 'camel' && (
        <View style={st.block}>
          <Text style={screenStyles.h1}>{o.camelTitle}</Text>
          <Text style={screenStyles.body}>{o.camelBody}</Text>
          <TextInput
            ref={dumpInput}
            value={dictation.listening && dictation.heard ? [dump.trimEnd(), dictation.heard].filter(Boolean).join('\n') : dump}
            onChangeText={setDump}
            editable={!dictation.listening}
            multiline
            placeholder={o.camelPlaceholder}
            placeholderTextColor={colors.faint}
            style={st.dump}
            accessibilityLabel="Everything you're carrying, one per line"
          />
          <Pressable accessibilityRole="button" onPress={mic} style={st.talk}>
            <MicButton listening={dictation.listening} onPress={mic} size={40} />
            <Text style={[st.talkText, dictation.listening && { color: colors.accent }]}>
              {dictation.listening ? o.doneTalking : o.talk}
            </Text>
          </Pressable>
          {(hint || dictation.listening) && <Text style={shared.faint}>{hint ?? copy.voiceListening}</Text>}
          <View style={shared.row}>
            <Button kind="primary" label={o.next} onPress={finishCamel} />
            <Button label={o.skip} onPress={() => go('child')} />
          </View>
        </View>
      )}

      {step === 'lion' && (
        <View style={st.block}>
          <Text style={screenStyles.h1}>{o.lionTitle}</Text>
          <Text style={screenStyles.body}>{o.lionBody}</Text>
          {lionTasks.map((t) => {
            const choice = choices[t.id] ?? 'keep';
            return (
              <View key={t.id} style={st.lionRow}>
                <Text style={[st.lionTitle, choice !== 'keep' && { color: colors.faint }]}>{t.title}</Text>
                <View style={shared.row}>
                  {(['keep', 'not_mine', 'not_now'] as Choice[]).map((c) => (
                    <Pressable
                      key={c}
                      accessibilityRole="button"
                      accessibilityState={{ selected: choice === c }}
                      onPress={() => setChoices({ ...choices, [t.id]: c })}
                      style={[shared.chip, choice === c && shared.chipOn]}
                    >
                      <Text style={[shared.chipText, choice === c && shared.chipTextOn]}>
                        {c === 'keep' ? o.keep : c === 'not_mine' ? o.notMine : o.notNowShort}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
          <View style={shared.row}>
            <Button kind="primary" label={o.next} onPress={finishLion} />
          </View>
        </View>
      )}

      {step === 'child' && (
        <View style={st.block}>
          <Text style={screenStyles.h1}>{o.childTitle}</Text>
          <Text style={screenStyles.body}>{o.childBody}</Text>
          <TextInput
            value={becoming}
            onChangeText={setBecoming}
            placeholder={copy.becoming.addPlaceholder}
            placeholderTextColor={colors.faint}
            style={st.line}
            accessibilityLabel="Who you are becoming"
          />
          <View style={{ gap: space.xs }}>
            {o.childExamples.map((ex) => (
              <Text key={ex} style={st.example} onPress={() => setBecoming(ex)}>{ex}</Text>
            ))}
          </View>
          <View style={shared.row}>
            <Button
              kind="primary"
              label={o.next}
              onPress={() => {
                if (becoming.trim()) dispatch({ type: 'add_becoming', id: newId(), statement: becoming });
                go('amor');
              }}
            />
            <Button label={o.childSkip} onPress={() => go('amor')} />
          </View>
        </View>
      )}

      {step === 'amor' && (
        <View style={st.block}>
          <Text style={screenStyles.h1}>{o.amorTitle}</Text>
          <Text style={screenStyles.body}>{o.amorBody}</Text>
          <View>
            <Text style={screenStyles.aphorism}>"{copy.aphorism.text}"</Text>
            <Text style={shared.faint}>{copy.aphorism.source}</Text>
          </View>
          <View style={shared.row}>
            <Button kind="primary" label={o.next} onPress={() => go('optin')} />
          </View>
        </View>
      )}

      {step === 'optin' && (
        <View style={st.block}>
          <Text style={screenStyles.h1}>{o.optInTitle}</Text>
          <Text style={screenStyles.body}>{o.optInBody}</Text>
          <View style={shared.row}>
            <Button kind="primary" label={o.optInYes} onPress={() => finish(true)} />
            <Button label={o.optInNo} onPress={() => finish(false)} />
          </View>
        </View>
      )}
    </Screen>
  );
}

const st = themed(() => ({
  block: { gap: space.lg },
  talk: { flexDirection: 'row', alignItems: 'center', gap: space.md, alignSelf: 'flex-start' },
  talkText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.accent },
  dump: {
    minHeight: 180, color: colors.ink, fontFamily: fonts.sans, fontSize: 17, lineHeight: 25, textAlignVertical: 'top',
    backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: space.md,
  },
  line: { color: colors.ink, fontFamily: fonts.serif, fontSize: 24, borderBottomWidth: 1, borderBottomColor: colors.accent, paddingVertical: space.xs },
  example: { color: colors.muted, fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 16, paddingVertical: 4 },
  lionRow: { gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  lionTitle: { color: colors.ink, fontFamily: fonts.sans, fontSize: 17 },
}));
