import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Routine } from '../domain/model';
import { isWaitingOnCue } from '../domain/intention';
import { computeEvidence, evidenceToShow, type Evidence } from '../domain/overcoming';
import { isActive, pickNow, rankTasks } from '../domain/planner';
import { DISMISSALS_BEFORE_ASKING, selectQuestions, shouldOfferSession } from '../domain/recurrence';
import { useApp } from '../state/AppStateContext';
import { newId } from '../state/useAppState';
import { AlsoHere, CaptureBar, EnergyBar, WinFlash, s as shared, type Flash } from '../ui/components';
import { copy } from '../ui/copy';
import { NowCard } from '../ui/NowCard';
import { FrequencyCard, RecurrenceCard } from '../ui/RecurrenceCard';
import { Screen, screenStyles } from '../ui/Screen';
import { colors, fonts } from '../ui/theme';
import { EvidenceCard, WaitingForCue } from '../ui/Waiting';
import { isFresh } from '../domain/undo';
import { HintSpot, useHint } from '../ui/Hint';

export default function NowScreen() {
  const { state, hydrated, dispatch, undo } = useApp();
  const [planning, setPlanning] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [aphorismHidden, setAphorismHidden] = useState(false);
  const [session, setSession] = useState<Routine[] | null>(null);
  // undefined: not checked yet this visit; null: nothing to show.
  const [evidence, setEvidence] = useState<Evidence | null | undefined>(undefined);

  const onWin = useCallback((text: string, sub?: string) => setFlash({ key: Date.now(), text, sub }), []);

  // The recurrence question rides the day's first win. Its queue is fixed when it opens.
  useEffect(() => {
    if (!hydrated || session) return;
    const at = new Date().toISOString();
    if (shouldOfferSession(state, at)) {
      setSession(selectQuestions(state, at));
      dispatch({ type: 'start_recurrence_session' });
    }
  }, [hydrated, state, session, dispatch]);

  // Evidence is checked once per visit, and marked shown the moment it appears.
  useEffect(() => {
    if (!hydrated || evidence !== undefined || !state.onboarding.completedAt) return;
    const at = new Date().toISOString();
    const found = evidenceToShow(computeEvidence(state.tasks, state.events, at), state.overcoming.lastShownAt, at) ?? null;
    setEvidence(found);
    if (found) dispatch({ type: 'evidence_shown', key: found.key });
  }, [hydrated, state, evidence, dispatch]);

  const at = new Date().toISOString();
  const now = pickNow(state, at);
  // Only what fits current energy; the rest is summarized by the "resting" line.
  const others = rankTasks(state.tasks, state.energy, at).filter((t) => t.id !== now.task?.id && !isWaitingOnCue(t));
  const firstRun = !state.events.some((e) => e.type === 'first_step_done');

  // One hint at a time, and only for what's on screen. The Undo bar and the plan editor get the stage to themselves.
  const undoShowing = isFresh(undo, Date.now());
  const hint = useHint(undoShowing || !state.onboarding.completedAt ? [] : planning ? ['plan'] : [
    !!now.task && !state.energy && 'energy',
    state.tasks.length > 0 && 'mic',
    !!now.task && now.task.state === 'open' && !firstRun && 'rename',
    others.length > 0 && 'also_here',
  ]);

  if (hydrated && !state.onboarding.completedAt) return <Redirect href="/onboarding" />;
  const waiting = state.tasks.filter((t) => isActive(t) && isWaitingOnCue(t) && t.id !== now.task?.id);
  const becoming = state.becomings.find((b) => b.status === 'active');
  const askFrequency =
    state.recurrence.enabled && !state.recurrence.askedAboutFrequency && state.recurrence.dismissStreak >= DISMISSALS_BEFORE_ASKING;

  return (
    <View style={{ flex: 1 }}>
      <Screen nav={{ href: '/becoming', label: copy.becomingLink }}>
        {becoming ? <Text style={{ color: colors.muted, fontFamily: fonts.serif, fontStyle: 'italic', marginTop: -12 }}>becoming {becoming.statement}</Text> : null}

        <EnergyBar value={state.energy} onChange={(level) => dispatch({ type: 'set_energy', level })} />
        <HintSpot id="energy" auto={hint} />
        {state.energy === 'fried' ? <Text style={{ color: colors.accent, fontFamily: fonts.sans, fontSize: 14 }}>{copy.friedNote}</Text> : null}

        {askFrequency ? <FrequencyCard dispatch={dispatch} /> : null}
        {evidence ? <EvidenceCard evidence={evidence} onNoted={() => setEvidence(null)} /> : null}
        {session?.length ? (
          <RecurrenceCard queue={session} state={state} dispatch={dispatch} onWin={onWin} onClose={() => setSession([])} />
        ) : null}

        {!hydrated ? null : now.task ? (
          <NowCard
            task={now.task}
            reason={now.reason}
            becomings={state.becomings}
            showHint={firstRun}
            hint={hint === 'plan' || hint === 'rename' ? hint : undefined}
            onPlanning={setPlanning}
            tasks={state.tasks} dispatch={dispatch} onWin={onWin} />
        ) : (
          <View style={{ paddingVertical: 24, gap: 24 }}>
            <Text style={screenStyles.h2}>{copy.emptyNow}</Text>
            {!aphorismHidden ? (
              <Pressable onPress={() => setAphorismHidden(true)} accessibilityHint="Tap to hide">
                <Text style={screenStyles.aphorism}>"{copy.aphorism.text}"</Text>
                <Text style={shared.faint}>{copy.aphorism.source}</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {now.heldBack > 0 ? <Text style={shared.faint}>{copy.heldBack(now.heldBack)}</Text> : null}

        <WaitingForCue tasks={waiting} all={state.tasks} onFire={(taskId) => dispatch({ type: 'fire_intention', taskId })} />

        <HintSpot id="mic" auto={hint} caret="down" align="right" />
        <CaptureBar onCapture={(title, via) => dispatch({ type: 'capture', id: newId(), title, via })} />

        <HintSpot id="also_here" auto={hint} caret="down" />
        <AlsoHere
          tasks={others}
          onPick={(taskId) => dispatch({ type: 'pin_now', taskId })}
          onRename={(taskId, title) => dispatch({ type: 'rename', taskId, title })}
          onRelease={(taskId) => dispatch({ type: 'release', taskId })}
        />
      </Screen>
      <WinFlash flash={flash} />
    </View>
  );
}
