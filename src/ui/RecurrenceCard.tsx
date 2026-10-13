import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Routine } from '../domain/model';
import { MOSTLY_NO_RATIO, mightBeTheMood, shouldAskForLink } from '../domain/recurrence';
import type { AppState } from '../domain/reducer';
import { newId, type Dispatch } from '../state/useAppState';
import { Button, s as shared } from './components';
import { copy } from './copy';
import { colors, fonts, space, themed } from './theme';

type Phase = 'ask' | 'no' | 'unsure' | 'reshape' | 'link' | 'note' | 'mostly_no';

interface Props {
  /** Routines picked for this session, fixed when it opened. */
  queue: Routine[];
  state: AppState;
  dispatch: Dispatch;
  onWin: (text: string) => void;
  onClose: () => void;
}

const c = copy.recurrence;

/** The signature question. Serious question, light interface: two seconds per item. */
export function RecurrenceCard({ queue, state, dispatch, onWin, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('ask');
  const [answers, setAnswers] = useState<string[]>([]);
  const [moodCheck, setMoodCheck] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  const queued = queue[index];
  // Read the live routine so follow-ups see the latest title and links.
  const routine = queued ? state.routines.find((r) => r.id === queued.id) ?? queued : undefined;
  const activeBecomings = state.becomings.filter((b) => b.status === 'active');

  if (!routine) return null;
  const id = routine.id;

  const advance = (given: string[] = answers) => {
    const noShare = given.filter((a) => a === 'no').length / Math.max(1, given.length);
    if (given.length >= 2 && noShare > MOSTLY_NO_RATIO && index + 1 < queue.length) {
      setPhase('mostly_no');
      return;
    }
    if (index + 1 >= queue.length) {
      onClose();
      return;
    }
    setIndex(index + 1);
    setPhase('ask');
  };

  const answer = (a: 'yes' | 'no' | 'unsure' | 'skipped') => {
    const mood = a === 'no' && mightBeTheMood(routine, state.energy);
    dispatch({ type: 'answer_recurrence', id: newId(), routineId: id, answer: a });
    const given = a === 'skipped' ? answers : [...answers, a];
    setAnswers(given);
    if (a === 'yes') {
      // Tolls answered "fine as is" are acceptance, not affirmation; no identity question for them.
      if (routine.nature !== 'toll' && shouldAskForLink(routine, activeBecomings.length > 0, new Date().toISOString())) setPhase('link');
      else advance(given);
    } else if (a === 'no') {
      setMoodCheck(mood);
      setPhase('no');
    } else if (a === 'unsure') {
      setPhase('unsure');
    } else {
      advance(given);
    }
  };

  const follow = (f: 'make_rarer' | 'mark_toll_and_lighten' | 'release' | 'keep_anyway' | 'later', noteText?: string) => {
    dispatch({ type: 'follow_up_recurrence', routineId: id, followUp: f });
    if (f === 'release') {
      onWin(copy.released);
      advance();
    } else if (noteText) {
      setNote(noteText);
      setPhase('note');
    } else {
      advance();
    }
  };

  const startReshape = () => {
    setDraft(routine.title);
    setPhase('reshape');
  };

  const header = (
    <View style={st.head}>
      <Text style={shared.faint}>{index + 1} of {queue.length}</Text>
      <Text style={st.close} accessibilityRole="button" onPress={() => { dispatch({ type: 'dismiss_recurrence_session' }); onClose(); }}>{c.close}</Text>
    </View>
  );

  let body: React.ReactNode;
  if (phase === 'ask' && routine.nature === 'toll') {
    body = (
      <>
        <Text style={st.title}>{routine.title}</Text>
        <Text style={st.q}>{c.tollTitle} {c.tollBody}</Text>
        <View style={shared.row}>
          <Button kind="primary" label={c.rarer} onPress={() => { dispatch({ type: 'answer_recurrence', id: newId(), routineId: id, answer: 'unsure' }); follow('make_rarer', c.rarerNote); }} />
          <Button label={c.lowerBar} onPress={() => { dispatch({ type: 'answer_recurrence', id: newId(), routineId: id, answer: 'unsure' }); startReshape(); }} />
          <Button label={c.tollFine} onPress={() => answer('yes')} />
        </View>
      </>
    );
  } else if (phase === 'ask') {
    body = (
      <>
        <Text style={st.q}>{c.question}</Text>
        <Text style={st.title}>{routine.title.toUpperCase()}</Text>
        <View style={shared.row}>
          <Button kind="primary" label={c.yes} onPress={() => answer('yes')} />
          <Button label={c.no} onPress={() => answer('no')} />
        </View>
        <View style={[shared.row, { gap: space.md }]}>
          <Text style={st.link} accessibilityRole="button" onPress={() => answer('unsure')}>{c.unsure}</Text>
          <Text style={st.link} accessibilityRole="button" onPress={() => answer('skipped')}>{c.skip}</Text>
        </View>
      </>
    );
  } else if (phase === 'no') {
    body = (
      <>
        <Text style={st.title}>{c.noTitle}</Text>
        <Text style={shared.faint}>{routine.title}</Text>
        <View style={st.menu}>
          {moodCheck ? <Button kind="primary" label={c.betterDay} onPress={() => follow('later')} /> : null}
          <Button kind={moodCheck ? 'quiet' : 'primary'} label={c.reshape} onPress={startReshape} />
          <Button label={c.rarer} onPress={() => follow('make_rarer', c.rarerNote)} />
          <Button label={c.toll} onPress={() => follow('mark_toll_and_lighten', c.tollNote)} />
          <Button label={c.letGo} onPress={() => follow('release')} />
          <Button label={c.keep} onPress={() => follow('keep_anyway', c.keptNote)} />
        </View>
      </>
    );
  } else if (phase === 'unsure') {
    body = (
      <>
        <Text style={st.title}>{c.unsureTitle}</Text>
        <Text style={st.q}>{c.unsureBody}</Text>
        <View style={shared.row}>
          <Button kind="primary" label={c.lookCloser} onPress={() => setPhase('no')} />
          <Button label={c.nextWeek} onPress={() => advance()} />
        </View>
      </>
    );
  } else if (phase === 'reshape') {
    body = (
      <>
        <Text style={st.q}>{c.reshapeTitle}</Text>
        <TextInput value={draft} onChangeText={setDraft} autoFocus style={st.input} accessibilityLabel="New shape for this routine" />
        <View style={shared.row}>
          <Button
            kind="primary"
            label={copy.save}
            onPress={() => {
              dispatch({ type: 'follow_up_recurrence', routineId: id, followUp: 'reshape' });
              dispatch({ type: 'reshape_routine', routineId: id, title: draft });
              advance();
            }}
          />
          <Button label={copy.cancel} onPress={() => setPhase('no')} />
        </View>
      </>
    );
  } else if (phase === 'link') {
    body = (
      <>
        <Text style={st.title}>{c.linkTitle}</Text>
        <Text style={shared.faint}>{routine.title}</Text>
        <View style={shared.row}>
          {activeBecomings.map((b) => (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              style={shared.chip}
              onPress={() => { dispatch({ type: 'link_routine_becoming', routineId: id, becomingId: b.id }); advance(); }}
            >
              <Text style={[shared.chipText, { color: colors.ink }]}>{b.statement}</Text>
            </Pressable>
          ))}
          <Text style={st.link} accessibilityRole="button" onPress={() => { dispatch({ type: 'link_routine_becoming', routineId: id, becomingId: null }); advance(); }}>{c.skip}</Text>
        </View>
      </>
    );
  } else if (phase === 'note') {
    body = (
      <>
        <Text style={st.title}>{note}</Text>
        <View style={shared.row}>
          <Button kind="primary" label={copy.onboarding.next} onPress={() => advance()} />
        </View>
      </>
    );
  } else {
    body = (
      <>
        <Text style={st.q}>{c.mostlyNo}</Text>
        <View style={shared.row}>
          <Button kind="primary" label={c.close} onPress={onClose} />
        </View>
      </>
    );
  }

  return (
    <View style={st.card} accessibilityLabel="Eternal recurrence question">
      {header}
      {body}
    </View>
  );
}

/** Shown once, after three dismissals in a row. Then the app obeys. */
export function FrequencyCard({ dispatch }: { dispatch: Dispatch }) {
  return (
    <View style={st.card}>
      <Text style={st.title}>{c.frequencyTitle}</Text>
      <Text style={st.q}>{c.frequencyBody}</Text>
      <View style={shared.row}>
        <Button kind="primary" label={c.less} onPress={() => dispatch({ type: 'set_recurrence_frequency', choice: 'less' })} />
        <Button label={c.off} onPress={() => dispatch({ type: 'set_recurrence_frequency', choice: 'off' })} />
        <Button label={c.same} onPress={() => dispatch({ type: 'set_recurrence_frequency', choice: 'same' })} />
      </View>
    </View>
  );
}

const st = themed(() => ({
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.accent, padding: space.lg, gap: space.md, backgroundColor: colors.accentCard },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  close: { color: colors.faint, fontFamily: fonts.sans, fontSize: 13, paddingVertical: space.xs, paddingLeft: space.md },
  q: { color: colors.ink, fontFamily: fonts.serif, fontSize: 18, lineHeight: 26, fontStyle: 'italic', opacity: 0.9 },
  title: { color: colors.ink, fontFamily: fonts.serif, fontSize: 24, lineHeight: 31, letterSpacing: 0.5 },
  menu: { gap: space.xs, alignItems: 'flex-start' },
  link: { color: colors.muted, fontFamily: fonts.sans, fontSize: 13, textDecorationLine: 'underline', paddingVertical: space.xs },
  input: { color: colors.ink, fontFamily: fonts.serif, fontSize: 22, borderBottomWidth: 1, borderBottomColor: colors.accent, paddingVertical: space.xs },
}));
