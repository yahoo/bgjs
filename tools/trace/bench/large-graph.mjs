// Tracing cost on a large graph: N extents, E events that each touch one extent.
//   node bench/large-graph.mjs [extents=5000] [events=1000]
// Prints the untraced time, the traced time, and the size of the trace JSON, unfiltered and
// with a filter that keeps one extent.
import * as bg from 'behavior-graph';
import { traceGraph } from '../src/tracer.js';

const N = +(process.argv[2] ?? 5000);
const E = +(process.argv[3] ?? 1000);
const filterMod = await import('../src/filter.js').catch(() => null);

class Cell extends bg.Extent {
  constructor(graph, i) {
    super(graph);
    this.debugName = 'Cell' + i;
    this.input = this.state(0);
    this.output = this.state(0);
    this.behavior().demands(this.input).supplies(this.output).runs(() => this.output.update(this.input.value * 2));
  }
}

function run(options) {
  const graph = new bg.Graph();
  const tracer = options ? traceGraph(graph, options) : null;
  const cells = [];
  for (let i = 0; i < N; i++) cells.push(new Cell(graph, i));
  const a0 = performance.now();
  graph.action(() => cells.forEach(c => c.addToGraph()), 'add cells');
  const add = performance.now() - a0;
  const t0 = performance.now();
  for (let e = 0; e < E; e++) graph.action(() => cells[e % N].input.update(e + 1), 'tick');
  const ms = performance.now() - t0;
  const data = tracer?.toJSON();
  const bytes = data ? JSON.stringify(data).length : 0;
  const tickBytes = data ? data.traces.slice(1).reduce((n, t) => n + JSON.stringify(t).length, 0) : 0;
  return { add, ms, bytes, tickBytes };
}

const size = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${(b / 1e3).toFixed(1)} KB`);
const fmt = ({ add, ms, bytes, tickBytes }) =>
  `add ${add.toFixed(1)} ms, ${E} events ${ms.toFixed(1)} ms; JSON ${size(bytes)} (events after the add: ${size(tickBytes)})`;
console.log(`${N} extents, ${E} events`);
console.log('untraced:            ' + fmt(run(null)));
console.log('traced:              ' + fmt(run({})));
if (filterMod) console.log('traced, one extent:  ' + fmt(run({ filter: filterMod.filters.extents('Cell7') })));
