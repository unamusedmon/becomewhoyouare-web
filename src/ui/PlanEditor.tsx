import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { cleanCue, CUE_SUGGESTIONS, intentionSentence, obstacleSentence, parseClock, timePresets } from '../domain/intention';
import type { IntentionTrigger, Task } from '../domain/model';
import { isActive } from '../domain/planner';
import type { Dispatch } from '../state/useAppState';
import { Button, s as shared } from './components';
import { copy } from './copy';
import { HintSpot, InfoButton } from './Hint';
import { colors, fonts, space, themed } from './theme';

const p = copy.plan;

type Mode = 'event' | 'after' | 'time';
const MODES: Mode[] = ['event', 'after', 'time'];

/** "When X, where Y, I'll do the first step. If I stall, then Z." Nothing in it is required but the when. */
export function PlanEditor({ task, tasks, dispatch, onDone, showHint }: { task: Task; tasks: Task[]; dispatch: Dispatch; onDone: (saved: boolean) => void; showHint?: boolean }) {
  const i = task.intention;
  const [cue, setCue] = useState(i?.trigger.kind === 'event' ? i.trigger.text : '');
  const [afterId, setAfterId] = useState<string | undefined>(i?.trigger.kind === 'after_task' ? i.trigger.taskId : undefined);
  const [timeAt, setTimeAt] = useState<Date | undefined>(i?.trigger.kind === 'time' ? new Date(i.trigger.at) : undefined);
  const [timeText, setTimeText] = useState('');
  const [presets] = useState(() => timePresets());
  // One kind of "when" at a time, so the editor shows a handful of controls instead of all of them.
  const [mode, setMode] = useState<Mode>(i?.trigger.kind === 'after_task' ? 'after' : i?.trigger.kind === 'time' ? 'time' : 'event');
  const [where, setWhere] = useState(i?.context ?? '');
  const [stall, setStall] = useState(!!i?.ifObstacle);
  const [extras, setExtras] = useState(!!i?.context || !!i?.ifObstacle);
  const [obstacle, setObstacle] = useState(i?.ifObstacle?.obstacle ?? '');
  const [response, setResponse] = useState(i?.ifObstacle?.response ?? '');
  // After saving: the plan read back once. Rehearsing an if-then plan strengthens it (Sheeran et al., 2024).
  const [readBack, setReadBack] = useState<string[] | null>(null);

  const anchors = tasks.filter((t) => isActive(t) && t.id !== task.id).slice(0, 4);
  const trigger: IntentionTrigger | undefined =
    mode === 'time' ? (timeAt ? { kind: 'time', at: timeAt.toISOString() } : undefined)
      : mode === 'after' ? (afterId ? { kind: 'after_task', taskId: afterId } : undefined)
        : cleanCue(cue) ? { kind: 'event', text: cleanCue(cue) } : undefined;
  const modes = MODES.filter((m) => m !== 'after' || anchors.length);
  const preview = trigger
    ? intentionSentence({ ...task, intention: { trigger, context: where, setAt: '' } }, tasks)
    : undefined;

  const save = () => {
    if (!trigger) return;
    const ifObstacle = stall && obstacle.trim() && response.trim() ? { obstacle, response } : undefined;
    dispatch({ type: 'set_intention', taskId: task.id, trigger, context: where, ifObstacle });
    const lines = [preview, ifObstacle ? obstacleSentence({ trigger, setAt: '', ifObstacle }) : undefined];
    setReadBack(lines.filter((l): l is string => !!l));
  };

  if (readBack) {
    return (
      <View style={st.card}>
        <Text style={st.title}>{p.readBackTitle}</Text>
        {readBack.map((line) => <Text key={line} style={st.readBack}>{line}</Text>)}
        <View style={shared.row}>
          <Button kind="primary" label={p.readBackDone} onPress={() => onDone(true)} />
        </View>
      </View>
    );
  }

  return (
    <View style={st.card}>
      <View style={st.titleRow}>
        <Text style={[st.title, { flexShrink: 1 }]}>{p.title}</Text>
        <InfoButton id="plan" />
      </View>
      <Text style={st.body}>{p.body}</Text>
      <Text style={shared.faint}>{task.title}</Text>

      <HintSpot id="plan" auto={showHint ? 'plan' : undefined} caret="down" />
      <View style={st.tabs} accessibilityRole="tablist">
        {modes.map((m) => (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            onPress={() => setMode(m)}
            style={[st.tab, mode === m && st.tabOn]}
          >
            <Text style={[st.tabText, mode === m && st.tabTextOn]}>{p.modes[m]}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'event' && (
        <View style={st.field}>
          <Text style={shared.label}>{p.when}</Text>
          <TextInput
            value={cue}
            onChangeText={setCue}
            placeholder={p.whenPlaceholder}
            placeholderTextColor={colors.faint}
            style={st.input}
            accessibilityLabel="When"
          />
          <View style={shared.row}>
            {CUE_SUGGESTIONS.map((c) => (
              <Chip key={c} label={c} on={cue === c} onPress={() => setCue(c)} />
            ))}
          </View>
        </View>
      )}

      {mode === 'after' && (
        <View style={st.field}>
          <Text style={shared.label}>{p.after}</Text>
          <View style={shared.row}>
            {anchors.map((t) => (
              <Chip key={t.id} label={t.title} on={afterId === t.id} onPress={() => setAfterId(afterId === t.id ? undefined : t.id)} />
            ))}
          </View>
        </View>
      )}

      {mode === 'time' && (
        <View style={st.field}>
          <Text style={shared.label}>{p.atTime}</Text>
          <View style={shared.row}>
            {presets.map((x) => (
              <Chip
                key={x.label}
                label={x.label}
                on={!!timeAt && !timeText && timeAt.getTime() === x.at.getTime()}
                onPress={() => { setTimeText(''); setTimeAt(x.at); }}
              />
            ))}
          </View>
          <TextInput
            value={timeText}
            onChangeText={(t) => { setTimeText(t); setTimeAt(parseClock(t)); }}
            placeholder={p.timePlaceholder}
            placeholderTextColor={colors.faint}
            style={st.input}
            keyboardType={Platform.OS === 'android' ? 'default' : 'numbers-and-punctuation'}
            autoCapitalize="none"
            accessibilityLabel="At a time"
          />
          {timeText && !timeAt ? <Text style={shared.faint}>{p.timeHelp}</Text> : null}
        </View>
      )}

      {/* Extras only once there's a when to hang them on. */}
      {trigger && (where || extras) ? (
        <View style={st.field}>
          <Text style={shared.label}>{p.where}</Text>
          <TextInput
            value={where}
            onChangeText={setWhere}
            placeholder={p.wherePlaceholder}
            placeholderTextColor={colors.faint}
            style={st.input}
            accessibilityLabel="Where"
          />
        </View>
      ) : null}

      {trigger && stall ? (
        <View style={st.field}>
          <Text style={shared.label}>{p.ifLabel}</Text>
          <TextInput value={obstacle} onChangeText={setObstacle} placeholder={p.ifPlaceholder} placeholderTextColor={colors.faint} style={st.input} accessibilityLabel="If I" />
          <Text style={shared.label}>{p.thenLabel}</Text>
          <TextInput value={response} onChangeText={setResponse} placeholder={p.thenPlaceholder} placeholderTextColor={colors.faint} style={st.input} accessibilityLabel="Then I'll" />
        </View>
      ) : null}

      {trigger && !(extras || where) ? (
        <Text style={st.link} onPress={() => setExtras(true)}>{p.addPlace}</Text>
      ) : null}
      {trigger && (extras || where) && !stall ? (
        <Text style={st.link} onPress={() => setStall(true)}>{p.stall}</Text>
      ) : null}

      {preview ? <Text style={st.preview}>{preview}</Text> : null}

      <View style={shared.row}>
        <Button kind="primary" label={p.save} onPress={() => { save(); }} />
        <Button label={copy.cancel} onPress={() => onDone(false)} />
        {i ? <Button label={p.remove} onPress={() => { dispatch({ type: 'clear_intention', taskId: task.id }); onDone(false); }} /> : null}
      </View>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      android_ripple={{ color: colors.line, borderless: false }}
      style={[shared.chip, on && shared.chipOn, { maxWidth: '100%' }]}
    >
      <Text style={[shared.chipText, on && shared.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const st = themed(() => ({
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.md },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: 24, lineHeight: 30 },
  body: { color: colors.ink, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, opacity: 0.85 },
  field: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  input: {
    color: colors.ink, fontFamily: fonts.sans, fontSize: 16, backgroundColor: colors.bg,
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 11,
  },
  readBack: { color: colors.ink, fontFamily: fonts.serif, fontSize: 20, lineHeight: 28 },
  preview: { color: colors.accent, fontFamily: fonts.serif, fontSize: 18, lineHeight: 25, fontStyle: 'italic' },
  tabs: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: colors.line },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  tabOn: { backgroundColor: colors.line },
  tabText: { color: colors.muted, fontFamily: fonts.sans, fontSize: 14 },
  tabTextOn: { color: colors.ink },
  link: { color: colors.muted, fontFamily: fonts.sans, fontSize: 13, textDecorationLine: 'underline' },
}));
