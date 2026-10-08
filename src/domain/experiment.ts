/**
 * The first-step test: does seeing a generated first step actually make you start
 * sooner? It's the app's central bet and nobody has tested it, so this lets one
 * person test it on themselves. Opt-in. While it runs, about half of newly captured
 * tasks show just the task, with no generated step. Start latency is compared by arm,
 * where each task was assigned at capture (intention to treat), and nothing is
 * reported until both arms have enough starts.
 */
import { median } from './overcoming';
import type { FirstStep, ID, Task, TaskEvent } from './model';

export type Arm = 'with_step' | 'without_step';

export const MIN_PER_ARM = 10;

/** Stable and reducer-safe: the arm comes from the task id, which is already random. */
export function armFor(id: ID): Arm {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 2 === 0 ? 'with_step' : 'without_step';
}

/** The "without" arm: the task itself is all you see. */
export function holdoutStep(title: string): FirstStep {
  return { text: title, verb: '', estSeconds: 60, source: 'holdout', shrinkDepth: 0 };
}

export interface ArmResult { n: number; medianSec: number }
export interface TestResult { withStep: ArmResult; withoutStep: ArmResult }

export function firstStepTestResult(events: TaskEvent[], tasks: Task[]): TestResult | undefined {
  const known = new Set(tasks.map((t) => t.id));
  const arms = new Map<ID, Arm>();
  for (const e of events) {
    const arm = e.meta?.arm;
    if (e.type === 'created' && (arm === 'with_step' || arm === 'without_step') && known.has(e.taskId)) arms.set(e.taskId, arm);
  }
  const by: Record<Arm, number[]> = { with_step: [], without_step: [] };
  for (const e of events) {
    const arm = arms.get(e.taskId);
    const latency = e.meta?.latencySec;
    if (e.type === 'first_step_done' && arm && typeof latency === 'number') by[arm].push(latency);
  }
  if (by.with_step.length < MIN_PER_ARM || by.without_step.length < MIN_PER_ARM) return undefined;
  return {
    withStep: { n: by.with_step.length, medianSec: median(by.with_step) },
    withoutStep: { n: by.without_step.length, medianSec: median(by.without_step) },
  };
}

/** Counts so far, so the setting can say how close the result is. */
export function firstStepTestProgress(events: TaskEvent[]): { started: number; needed: number } {
  const armed = new Set(events.filter((e) => e.type === 'created' && e.meta?.arm).map((e) => e.taskId));
  const started = events.filter((e) => e.type === 'first_step_done' && armed.has(e.taskId) && typeof e.meta?.latencySec === 'number').length;
  return { started, needed: 2 * MIN_PER_ARM };
}
