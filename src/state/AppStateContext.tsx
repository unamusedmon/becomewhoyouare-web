import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';

import type { AppState } from '../domain/reducer';
import type { UndoSlot } from '../domain/undo';
import { useSync, type SyncControls } from './sync';
import { useThemeMode, type ThemeControls } from './theme';
import { useAppState, type Dispatch } from './useAppState';

interface Ctx {
  state: AppState;
  hydrated: boolean;
  dispatch: Dispatch;
  undo?: UndoSlot;
  undoLast: () => void;
  sync: SyncControls;
  /** Changing it re-renders every screen, and themed styles rebuild for the new palette. */
  theme: ThemeControls;
}

const AppStateContext = createContext<Ctx | null>(null);

const TICK_MS = 60_000;

/** Holds app state for every screen, and keeps routines spawning their tasks on time. */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const theme = useThemeMode();
  const app = useAppState();
  const { state, hydrated, dispatch } = app;
  const sync = useSync(state, hydrated, dispatch);
  const value = { ...app, sync, theme };

  useEffect(() => {
    if (!hydrated) return;
    dispatch({ type: 'tick' });
    const timer = setInterval(() => dispatch({ type: 'tick' }), TICK_MS);
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') dispatch({ type: 'tick' });
      else if (s === 'background') dispatch({ type: 'backgrounded' });
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [hydrated, dispatch]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}
