/**
 * The only place that talks to the speech recognizer. Expo Go does not ship
 * this native module, so it is loaded optionally: without it (or without a
 * recognizer on the phone, or without mic permission) `available` is false and
 * the caller falls back to the keyboard's own mic.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { copy } from '../ui/copy';

type Mod = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;
type Sub = { remove(): void };

const mod: Mod | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-speech-recognition') as typeof import('expo-speech-recognition')).ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
})();

const NORMAL_ENDINGS = new Set(['no-speech', 'aborted', 'speech-timeout']);
/**
 * Failures that usually mean the recognizer hiccuped, not that this phone
 * can't listen: the speech service restarting under us, a session still
 * winding down ("busy"), a flaky connection. One silent retry within the
 * same tap; only if it happens twice in a row does the person see a message.
 */
const TRANSIENT = new Set(['client', 'busy', 'network', 'network-timeout']);

function recognizerReady(): boolean {
  try {
    return !!mod && mod.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export type Dictation = {
  /** False means: send the person to the keyboard mic instead. */
  available: boolean;
  listening: boolean;
  /** What has been heard so far in this session, for live feedback. */
  heard: string;
  start(): Promise<boolean>;
  stop(): void;
};

/**
 * Listens until the person stops talking (or taps again) and hands over the final
 * transcript once. One utterance per tap; a few seconds of silence ends it.
 */
export function useDictation(onFinal: (transcript: string) => void, onProblem?: (note: string) => void): Dictation {
  const [available, setAvailable] = useState(recognizerReady);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const finals = useRef<string[]>([]);
  const subs = useRef<Sub[]>([]);
  const failure = useRef<string | null>(null);
  const retries = useRef(0);
  const active = useRef(false);
  const mounted = useRef(true);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const onProblemRef = useRef(onProblem);
  onProblemRef.current = onProblem;

  const cleanup = useCallback(() => {
    for (const s of subs.current) s.remove();
    subs.current = [];
  }, []);

  useEffect(() => () => {
    mounted.current = false;
    cleanup();
    try { mod?.abort(); } catch { /* already stopped */ }
  }, [cleanup]);

  /** Ends the tap: hands over what was heard, or explains why nothing was. */
  const settle = useCallback(() => {
    active.current = false;
    setListening(false);
    const text = finals.current.join(' ').trim();
    finals.current = [];
    setHeard('');
    if (text) return onFinalRef.current(text);
    if (failure.current) return onProblemRef.current?.(copy.voiceFailed(failure.current));
    onFinalRef.current('');
  }, []);

  /**
   * Opens a recognizer session. `retry` keeps words already caught in this tap
   * (and the retry budget), so a hiccup mid-dictation doesn't eat them.
   */
  const begin = useCallback((retry: boolean): boolean => {
    cleanup();
    if (!retry) {
      finals.current = [];
      retries.current = 0;
    }
    failure.current = null;
    subs.current = [
      mod!.addListener('result', (e) => {
        const text = e.results[0]?.transcript ?? '';
        if (e.isFinal) finals.current.push(text);
        setHeard([...finals.current, e.isFinal ? '' : text].join(' ').trim());
      }),
      mod!.addListener('error', (e) => {
        // "no-speech" and "aborted" are normal endings, not failures.
        if (NORMAL_ENDINGS.has(e.error)) return;
        failure.current = e.error;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') setAvailable(false);
      }),
      mod!.addListener('end', () => {
        cleanup();
        // A transient failure with nothing caught: start a fresh session and keep listening,
        // rather than making the person tap again into a recognizer that may just have restarted.
        if (!finals.current.length && failure.current && TRANSIENT.has(failure.current) && retries.current < 1 && mounted.current) {
          retries.current += 1;
          setTimeout(() => {
            if (active.current && mounted.current && !begin(true)) settle();
          }, 300);
          return;
        }
        settle();
      }),
    ];
    try {
      mod!.start({
        lang: 'en-US',
        interimResults: true,
        // The phone's own recognizer with its own mic, the same path as keyboard dictation.
        // Continuous mode and forced on-device recognition make the library record the mic itself
        // and pipe it in, which real phones reject with a "client" error. One utterance per tap,
        // with a long silence allowance so people can think between items.
        continuous: false,
        addsPunctuation: true,
        androidIntentOptions: {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 4000,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 4000,
        },
      });
    } catch {
      cleanup();
      return false;
    }
    return true;
  }, [cleanup, settle]);

  const start = useCallback(async () => {
    if (!mod || !recognizerReady()) {
      setAvailable(false);
      return false;
    }
    // A session is still winding down; a second tap must not open a second one.
    if (active.current) return false;
    const perm = await mod.requestPermissionsAsync().catch(() => ({ granted: false }));
    if (!perm.granted) {
      setAvailable(false);
      return false;
    }
    active.current = true;
    if (!begin(false)) {
      // The recognizer rejected the attempt outright (still busy). One retry covers the wind-down window.
      retries.current = 1;
      setTimeout(() => {
        if (active.current && mounted.current && !begin(true)) settle();
      }, 300);
    }
    setListening(true);
    return true;
  }, [begin, settle]);

  const stop = useCallback(() => {
    try { mod?.stop(); } catch { setListening(false); }
  }, []);

  return { available, listening, heard, start, stop };
}
