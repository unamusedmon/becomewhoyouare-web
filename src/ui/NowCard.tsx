import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { RESHAPE_DEPTH } from '../domain/firstStep';
import { intentionSentence, obstacleSentence } from '../domain/intention';
import type { Becoming, Task } from '../domain/model';
import type { Dispatch } from '../state/useAppState';
import { Button, RenameField, s as shared, useBackToClose } from './components';
import { completionLine, copy } from './copy';
import { clockLabel } from '../domain/duration';
import { HintSpot, InfoButton } from './Hint';
import { PlanEditor } from './PlanEditor';
import { colors, fonts, space, themed } from './theme';

interface Props {
  task: Task;
  reason?: string;
  becomings: Becoming[];
  /** First-run coaching: one line saying what to do, until the first step is ever done. */
  showHint?: boolean;
  /** All tasks, for "after X" plans. */
  tasks: Task[];
  dispatch: Dispatch;
  onWin: (text: string, sub?: string) => void;
  /** A one-time hint to show on the card, picked by the screen. */
  hint?: 'plan' | 'rename';
  onPlanning?: (open: boolean) => void;
}

/** The heart of the app: one task, shown as its first physical step. */
export function NowCard({ task, reason, becomings, showHint, tasks, dispatch, onWin, hint, onPlanning }: Props) {
  const [justStarted, setJustStarted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(task.firstStep.text);

  // Start latency is measured from the moment this card first shows the task.
  // The reducer ignores repeat opens, so this also re-arms the clock after "not now" leaves the same task here.
  useEffect(() => {
    if (!task.openedAt && task.state === 'open') dispatch({ type: 'open', taskId: task.id });
  }, [task.id, task.openedAt, task.state]);
  useEffect(() => {
    setJustStarted(false);
    setEditing(false);
    setPlanning(false);
    setRenaming(false);
  }, [task.id]);

  useEffect(() => { onPlanning?.(planning); }, [planning, onPlanning]);
  useEffect(() => () => onPlanning?.(false), [onPlanning]);

  const closeEditors = useCallback(() => { setEditing(false); setPlanning(false); }, []);
  useBackToClose(editing || planning, closeEditors);

  const id = task.id;
  const feeds = becomings.find((b) => b.status === 'active' && task.becomingIds?.includes(b.id));
  const fired = !!task.intention?.firedAt;
  const plan = task.intention && !fired ? intentionSentence(task, tasks) : undefined;
  const stall = task.intention ? obstacleSentence(task.intention) : undefined;
  const meta = [task.duration.experiential.label, feeds ? copy.feeds(feeds.statement) : fired ? undefined : reason].filter(Boolean).join(' · ');

  if (planning) {
    return <PlanEditor task={task} tasks={tasks} dispatch={dispatch} showHint={hint === 'plan'} onDone={(saved) => { setPlanning(false); if (saved) onWin(copy.plan.saved); }} />;
  }

  if (renaming) {
    return (
      <View style={st.card}>
        <Text style={shared.label}>{copy.renameTitle}</Text>
        <RenameField title={task.title} onCancel={() => setRenaming(false)} onSave={(t) => { dispatch({ type: 'rename', taskId: id, title: t }); setRenaming(false); }} />
      </View>
    );
  }

  if (editing) {
    return (
      <View style={st.card}>
        <Text style={shared.label}>{task.title}</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          autoFocus
          multiline
          style={[st.step, st.input]}
          accessibilityLabel="First step in your own words"
        />
        <View style={shared.row}>
          <Button kind="primary" label={copy.save} onPress={() => { dispatch({ type: 'edit_step', taskId: id, text: draft }); dispatch({ type: 'keep_anyway', taskId: id }); setEditing(false); }} />
          <Button label={copy.cancel} onPress={() => setEditing(false)} />
        </View>
      </View>
    );
  }

  if (task.slipPromptPending) {
    const reshape = task.firstStep.shrinkDepth >= RESHAPE_DEPTH - 1;
    return (
      <View style={st.card}>
        <Text style={st.title}>{reshape ? copy.reshapeTitle : copy.slipTitle}</Text>
        <Text style={st.body}>{reshape ? copy.reshapeBody : copy.slipBody}</Text>
        <Text style={shared.faint}>{task.title}</Text>
        <View style={shared.row}>
          {reshape ? (
            <Button kind="primary" label={copy.editStep} onPress={() => { setDraft(task.firstStep.text); setEditing(true); }} />
          ) : (
            <Button kind="primary" label={copy.shrink} onPress={() => { dispatch({ type: 'keep_anyway', taskId: id }); dispatch({ type: 'shrink', taskId: id }); }} />
          )}
          {!task.intention ? (
            <Button label={copy.plan.slipOption} onPress={() => { dispatch({ type: 'keep_anyway', taskId: id }); setPlanning(true); }} />
          ) : null}
          <Button label={copy.letGo} onPress={() => { dispatch({ type: 'release', taskId: id }); onWin(copy.released); }} />
          <Button label={copy.itsFine} onPress={() => dispatch({ type: 'keep_anyway', taskId: id })} />
        </View>
      </View>
    );
  }

  if (task.state === 'started') {
    if (justStarted) {
      return (
        <View style={st.card}>
          <Text style={[st.step, { color: colors.win }]}>{copy.started}</Text>
          <Text style={shared.faint}>{task.title}</Text>
          {/* Same shape as the step it replaces: one wide gold button, the quiet way out centered below. */}
          <Button kind="primary" wide label={copy.keepGoing} onPress={() => setJustStarted(false)} />
          <View style={[shared.row, { justifyContent: 'center' }]}>
            <Button label={copy.thatCounts} onPress={() => { setJustStarted(false); dispatch({ type: 'pause', taskId: id }); }} />
          </View>
        </View>
      );
    }
    return (
      <View style={st.card}>
        <Text style={shared.label}>{copy.pickUp}</Text>
        <Text style={st.step}>{task.title}</Text>
        <Text style={shared.faint}>{task.duration.experiential.label} · {clockLabel(task.duration.plannedMinutes)}</Text>
        {stall ? <Text style={st.stall}>{stall}</Text> : null}
        <View style={shared.row}>
          <Button kind="primary" label={copy.done} onPress={() => { dispatch({ type: 'complete', taskId: id }); onWin(copy.doneFlash, completionLine(Date.now())); }} />
          <Button label={copy.notNow} onPress={() => dispatch({ type: 'pause', taskId: id })} />
        </View>
      </View>
    );
  }

  return (
    <View style={st.card}>
      {/* Read top to bottom: what this is for, the one thing to do, the one button to press. */}
      <View style={{ gap: 2 }}>
        {fired ? <Text style={[shared.label, { color: colors.accent }]}>{copy.plan.firedHeader}</Text> : null}
        <Text style={st.task} numberOfLines={2} onPress={() => setRenaming(true)} accessibilityRole="button" accessibilityHint={copy.renameHint}>{task.title}</Text>
        <View style={st.metaRow}>
          <Text style={[shared.faint, { flexShrink: 1 }]}>{meta}</Text>
          <InfoButton id="rename" />
        </View>
        <View style={{ marginTop: space.xs }}><HintSpot id="rename" auto={hint} /></View>
      </View>
      <View style={st.divider} />
      <View style={{ gap: space.xs }}>
        <Text style={st.stepLabel}>{task.firstStep.source === 'holdout' ? copy.holdoutLabel : copy.firstStepLabel}</Text>
        <Text style={st.step} accessibilityRole="header">{task.firstStep.text}</Text>
      </View>
      {showHint ? <Text style={st.hint}>{copy.firstStepHint}</Text> : null}
      {plan ? <Text style={st.stall}>{plan}</Text> : null}
      {stall ? <Text style={st.stall}>{stall}</Text> : null}
      <Button
        kind="primary"
        wide
        label={copy.didIt}
        onPress={() => { dispatch({ type: 'first_step_done', taskId: id }); setJustStarted(true); onWin(copy.started); }}
      />
      <View style={[shared.row, { justifyContent: 'center', gap: space.lg }]}>
        <Button label={copy.tooBig} onPress={() => dispatch({ type: 'shrink', taskId: id })} />
        <Button label={copy.notNow} onPress={() => dispatch({ type: 'not_now', taskId: id })} />
      </View>
      <View style={[shared.row, { justifyContent: 'center', gap: space.md, marginTop: -space.sm }]}>
        {task.firstStep.alternatives?.length ? (
          <Text style={st.link} accessibilityRole="button" onPress={() => dispatch({ type: 'next_alternative', taskId: id })}>{copy.anotherStep}</Text>
        ) : null}
        <Text style={st.link} accessibilityRole="button" onPress={() => { setDraft(task.firstStep.text); setEditing(true); }}>{copy.editStep}</Text>
        <Text style={st.link} accessibilityRole="button" onPress={() => setPlanning(true)}>{task.intention ? copy.plan.change : copy.plan.link}</Text>
      </View>
    </View>
  );
}

const st = themed(() => ({
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.md },
  step: { color: colors.ink, fontFamily: fonts.serif, fontSize: 30, lineHeight: 38 },
  task: { color: colors.ink, fontFamily: fonts.sans, fontSize: 17, lineHeight: 23, opacity: 0.9 },
  // Sentence case, like everything else: the tone guide keeps capitals for the recurrence card alone.
  stepLabel: { color: colors.accent, fontFamily: fonts.sans, fontSize: 13, letterSpacing: 0.3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hint: { color: colors.muted, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  input: { borderBottomWidth: 1, borderBottomColor: colors.accent, paddingVertical: space.xs },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: 24, lineHeight: 30 },
  body: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23, opacity: 0.85 },
  stall: { color: colors.muted, fontFamily: fonts.serif, fontSize: 15, lineHeight: 21, fontStyle: 'italic' },
  link: { color: colors.muted, fontFamily: fonts.sans, fontSize: 13, textDecorationLine: 'underline', paddingVertical: space.sm },
}));
