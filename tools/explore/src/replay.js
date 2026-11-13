// Replay a counterexample with bg-trace attached, so each step's events can be read as text,
// drawn, or stepped through in the HTML replay. Uses the tracer in ../trace (same repository).
import { traceGraph } from '../../trace/src/tracer.js';
import { replayExplore, stepKey } from './explore.js';

/**
 * Replays `steps` in a fresh system with a tracer on every graph. Each event is labelled with
 * the step that started it (`step 2: setA 1`). Returns the replay's result and one trace per
 * graph (`tracer.toJSON()` format, ready for `explain`, `toMermaid` or `toHTML`).
 * @param {import('./explore.js').ExploreOptions<any>} opts
 * @param {import('./explore.js').ExploreStep[]} steps
 * @param {{ name?: (tracer: any, graph: any) => void }} [options] `name` is called once the
 *   system is built, to name behaviors (`tracer.nameBehaviors(...)`).
 */
export function traceCounterexample(opts, steps, options = {}) {
  const tracers = [];
  const result = replayExplore(opts, steps, {
    onGraph: (g) => tracers.push(traceGraph(g)),
    onStep: (step, i, run) => {
      if (i === 0) for (const t of tracers) options.name?.(t, t.graph);
      const label = `step ${i + 1}: ${stepKey(step)}`;
      // nest withSource so every graph's tracer labels the events this step starts
      tracers.reduceRight((inner, t) => () => t.withSource(label, inner), run)();
    },
  });
  for (const t of tracers) t.stop();
  return { ...result, traces: tracers.map((t) => t.toJSON()) };
}
