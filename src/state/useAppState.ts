import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { initialState, migrate, reducer, type Action, type AppState } from '../domain/reducer';
import { track, type UndoSlot } from '../domain/undo';

const STORAGE_KEY = 'bwya/state/v1';

type Internal = { app: AppState; hydrated: boolean; undo?: UndoSlot };
type InternalAction = Action | { type: 'hydrate'; state: AppState | null } | { type: 'undo' };

function internalReducer(s: Internal, a: InternalAction): Internal {
  if (a.type === 'hydrate') return { app: a.state ?? s.app, hydrated: true };
  if (a.type === 'undo') return s.undo ? { ...s, app: s.undo.before, undo: undefined } : s;
  const app = reducer(s.app, a);
  return { ...s, app, undo: track(s.undo, a, s.app, app) };
}

/** Distributes Omit over the union so each action keeps its own fields. */
type WithoutAt<A> = A extends unknown ? Omit<A, 'at'> : never;
export type Dispatch = (action: WithoutAt<Action>) => void;

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** App state, persisted on device. Nothing leaves the phone in this slice. */
export function useAppState(): { state: AppState; hydrated: boolean; dispatch: Dispatch; undo?: UndoSlot; undoLast: () => void } {
  const [s, rawDispatch] = useReducer(internalReducer, { app: initialState, hydrated: false });

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((json) => {
        const parsed = json ? (JSON.parse(json) as AppState) : null;
        if (!cancelled) rawDispatch({ type: 'hydrate', state: parsed?.version === 1 ? migrate(parsed) : null });
      })
      .catch(() => !cancelled && rawDispatch({ type: 'hydrate', state: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!s.hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s.app)).catch(() => {
        // Storage failed: state stays in memory for this session. Never the user's problem.
      });
    }, 250);
  }, [s.app, s.hydrated]);

  const dispatch = useCallback<Dispatch>(
    (action) => rawDispatch({ ...action, at: new Date().toISOString() } as Action),
    [],
  );

  const undoLast = useCallback(() => rawDispatch({ type: 'undo' }), []);

  return { state: s.app, hydrated: s.hydrated, dispatch, undo: s.undo, undoLast };
}
