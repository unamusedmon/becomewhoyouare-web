import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cueText } from '../domain/intention';
import type { Task } from '../domain/model';
import type { Evidence } from '../domain/overcoming';
import { Button, s as shared } from './components';
import { copy } from './copy';
import { colors, fonts, space, themed } from './theme';

/** Planned tasks waiting on their cue. An event cue gets an "it's now" for when it happens. */
export function WaitingForCue({ tasks, all, onFire }: { tasks: Task[]; all: Task[]; onFire: (id: string) => void }) {
  if (!tasks.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={shared.label}>{copy.plan.waiting}</Text>
      {tasks.map((t) => (
        <View key={t.id} style={st.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={st.cue} numberOfLines={2}>{cueText(t.intention!, all)}</Text>
            <Text style={shared.faint} numberOfLines={1}>{t.firstStep.text}</Text>
          </View>
          {t.intention!.trigger.kind !== 'after_task' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.plan.itsNow}: ${t.title}`}
              onPress={() => onFire(t.id)}
              android_ripple={{ color: colors.line }}
              style={st.now}
            >
              <Text style={st.nowText}>{copy.plan.itsNow}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** One real fact about getting better, shown rarely. See docs/design/04-copy-tone-guide.md. */
export function EvidenceCard({ evidence, onNoted }: { evidence: Evidence; onNoted: () => void }) {
  return (
    <View style={st.evidence}>
      <Text style={st.evidenceTitle}>{copy.evidence.title}</Text>
      <Text style={st.evidenceBody}>{evidence.headline}</Text>
      <View style={shared.row}>
        <Button label={copy.evidence.noted} onPress={onNoted} />
      </View>
    </View>
  );
}

const st = themed(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  cue: { color: colors.ink, fontFamily: fonts.serif, fontSize: 16, fontStyle: 'italic' },
  now: { borderWidth: 1, borderColor: colors.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden' },
  nowText: { color: colors.accent, fontFamily: fonts.sans, fontSize: 14 },
  evidence: { borderLeftWidth: 2, borderLeftColor: colors.win, paddingLeft: space.md, gap: space.sm },
  evidenceTitle: { color: colors.win, fontFamily: fonts.serif, fontSize: 20 },
  evidenceBody: { color: colors.ink, fontFamily: fonts.serif, fontSize: 17, lineHeight: 25 },
}));
