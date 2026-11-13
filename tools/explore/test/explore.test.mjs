import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bg from 'behavior-graph';
import { explore, replayExplore, exploreTouch, traceCounterexample } from '../src/index.js';
import { explain } from '../../trace/src/index.js';

const { Extent, Graph } = bg;

/** A counter that wraps at `limit`; `doubled` is derived, with an optional planted bug. */
class Counter extends Extent {
  constructor(graph, limit, bugAt) {
    super(graph);
    this.count = this.state(0);
    this.doubled = this.state(0);
    this.behavior().demands(this.count).supplies(this.doubled).runs((ext) => {
      ext.doubled.update(ext.count.value === bugAt ? 2 * ext.count.value + 1 : 2 * ext.count.value);
    });
    this.limit = limit;
  }
}

/** Two independent counters, plus an optional cross check that throws (an invariant as a behavior). */
class Pair extends Extent {
  constructor(graph, bugAt, crossCheck) {
    super(graph);
    this.a = new Counter(graph, 3, bugAt);
    this.b = new Counter(graph, 3, null);
    this.unifyLifetime(this.a);
    this.unifyLifetime(this.b);
    if (crossCheck) {
      this.behavior().demands(this.a.doubled, this.b.doubled).runs((ext) => {
        if (ext.a.doubled.value % 2 !== 0) throw new Error(`a.doubled is odd: ${ext.a.doubled.value}`);
      });
    }
  }
}

function options(bugAt, crossCheck, depth) {
  return {
    setup: () => {
      const g = new Graph();
      const p = new Pair(g, bugAt, crossCheck);
      g.action(() => { p.addToGraph(); p.a.addToGraph(); p.b.addToGraph(); });
      return p;
    },
    actions: [
      { name: 'incA', run: (p) => p.a.count.updateWithAction((p.a.count.value + 1) % p.a.limit) },
      { name: 'incB', run: (p) => p.b.count.updateWithAction((p.b.count.value + 1) % p.b.limit) },
    ],
    depth,
  };
}

test('visits each state once', () => {
  const r = explore(options(null, false, 10));
  assert.equal(r.ok, true);
  assert.equal(r.stats.states, 9);
  assert.equal(r.stats.truncated, false);
});

test('finds a violation from a check, with the shortest sequence', () => {
  const opts = { ...options(null, false, 10), checks: [(p) => (p.a.count.value === 2 && p.b.count.value === 1 ? 'a=2 and b=1' : undefined)] };
  const r = explore(opts);
  assert.equal(r.ok, false);
  assert.equal(r.counterexample.steps.length, 3);
  assert.deepEqual(r.counterexample.violations, ['a=2 and b=1']);
  const replay = replayExplore(opts, r.counterexample.steps);
  assert.equal(replay.failedAt, 3);
  assert.equal(replay.sys.a.count.value, 2);
});

test('an invariant can be a behavior that throws, with provenance', () => {
  const r = explore(options(2, true, 10));
  assert.equal(r.ok, false);
  assert.deepEqual(r.counterexample.steps, [{ action: 'incA' }, { action: 'incA' }]);
  assert.match(r.counterexample.violations[0], /a.doubled is odd: 5/);
  assert.deepEqual(r.counterexample.provenance.updated, ['Counter.count', 'Counter.doubled']);
});

test('inputs and enabled', () => {
  const opts = {
    ...options(null, false, 2),
    actions: [{ name: 'setA', inputs: [0, 1, 2], enabled: (p, v) => v !== p.a.count.value, run: (p, v) => p.a.count.updateWithAction(v) }],
    checks: [(p) => (p.a.doubled.value === 4 ? 'reached 4' : undefined)],
  };
  assert.deepEqual(explore(opts).counterexample.steps, [{ action: 'setA', input: 2 }]);
});

test('sleep sets skip commuting orders of independent steps', () => {
  const full = explore(options(null, false, 10));
  const reduced = explore({ ...options(null, false, 10), reduction: 'sleep' });
  assert.equal(reduced.ok, true);
  assert.equal(reduced.stats.states, 9);
  assert.ok(reduced.stats.slept > 0);
  assert.ok(reduced.stats.transitions < full.stats.transitions);
});

test('sleep sets still find the bug', () => {
  const r = explore({ ...options(null, false, 10), reduction: 'sleep', checks: [(p) => (p.a.count.value === 2 && p.b.count.value === 2 ? 'both 2' : undefined)] });
  assert.equal(r.ok, false);
  assert.equal(r.counterexample.steps.length, 4);
});

test('a shared environment key makes steps dependent', () => {
  const base = options(null, false, 10);
  const r = explore({ ...base, reduction: 'sleep', actions: base.actions.map((a) => ({ ...a, run: (p, i) => { exploreTouch('log', 'write'); a.run(p, i); } })) });
  assert.equal(r.stats.slept, 0);
});

test('cone of influence merges states that differ only outside the cone', () => {
  // incB would read b.count, outside the cone, which explore rejects; setB writes without reading
  const base = options(null, false, 10);
  const setB = { name: 'setB', inputs: [0, 1, 2], run: (p, v) => p.b.count.updateWithAction(v) };
  const r = explore({ ...base, actions: [base.actions[0], setB], cone: (p) => [p.a.doubled] });
  assert.equal(r.ok, true);
  assert.equal(r.stats.states, 3);
});

test('plain extent fields are part of the state', () => {
  class Tally extends Extent {
    constructor(g) {
      super(g);
      this.n = 0;
      this.tick = this.moment();
      this.behavior().demands(this.tick).runs((ext) => ext.sideEffect((e) => { e.n = (e.n + 1) % 4; }));
    }
  }
  const r = explore({
    setup: () => { const t = new Tally(new Graph()); t.addToGraphWithAction(); return t; },
    actions: [{ name: 'tick', run: (t) => t.tick.updateWithAction() }],
    depth: 10,
  });
  assert.equal(r.stats.states, 4);
});

test('Date.now inside a behavior throws during explore', () => {
  class Clocked extends Extent {
    constructor(g) {
      super(g);
      this.tick = this.moment();
      this.at = this.state(0);
      this.behavior().demands(this.tick).supplies(this.at).runs((ext) => ext.at.update(Date.now()));
    }
  }
  const r = explore({
    setup: () => { const c = new Clocked(new Graph()); c.addToGraphWithAction(); return c; },
    actions: [{ name: 'tick', run: (c) => c.tick.updateWithAction() }],
    depth: 2,
  });
  assert.match(r.counterexample.violations[0], /Date.now\(\) is not replayable: inject a fixed graph.dateProvider/);
  assert.equal(typeof Date.now(), 'number');
});

test('state outside the graph that envKey misses is caught on replay', () => {
  let leaked = 0;
  class Leaky extends Extent { constructor(g) { super(g); this.n = this.state(0); } }
  assert.throws(() => explore({
    setup: () => { const l = new Leaky(new Graph()); l.addToGraphWithAction(); return l; },
    actions: [{ name: 'inc', run: (l) => l.n.updateWithAction(++leaked) }],
    depth: 3,
  }), /not deterministic/);
});

test('random walks', () => {
  const r = explore({ ...options(2, true, 6), mode: 'random', walks: 200, seed: 3 });
  assert.equal(r.ok, false);
  assert.match(r.counterexample.violations[0], /odd/);
});

// --- specific to the tool version (no hooks in the library)

test('puts the library back when it returns, even after a violation', () => {
  // every own property of what explore wraps, by identity (deepEqual on Math's descriptors
  // fails after a plain reassign-and-restore, so compare the functions themselves)
  const wrapped = () => [bg.Graph.prototype, bg.Resource.prototype, bg.State.prototype, bg.Moment.prototype, bg.Extent.prototype,
    Promise.prototype, Date, Math, { Date: globalThis.Date }].map((o) => new Map(Reflect.ownKeys(o).map((k) => {
    const d = Object.getOwnPropertyDescriptor(o, k);
    return [k, [d.value, d.get, d.set]];
  })));
  const changed = (a, b) => a.flatMap((m, i) => [...new Set([...m.keys(), ...b[i].keys()])]
    .filter((k) => !m.has(k) || !b[i].has(k) || m.get(k).some((x, j) => !Object.is(x, b[i].get(k)[j]))).map((k) => `${i}:${String(k)}`));
  const before = wrapped();
  explore(options(2, true, 4));
  assert.deepEqual(changed(wrapped(), before), []);
  // and after the paths that stop the search with an error
  assert.throws(() => explore({ ...options(null, false, 2), actions: [{ name: 'p', run: async () => {} }] }), /returned a promise/);
  assert.throws(() => explore({ ...options(null, false, 2), setup: () => { Date.now(); } }), /not replayable/);
  assert.throws(() => explore({ ...options(null, false, 2), cone: (p) => [p.a.doubled] }), /outside the cone/);
  assert.deepEqual(changed(wrapped(), before), []);
  // the graphs explore built get the default dateProvider back
  const { sys } = replayExplore(options(null, false, 2), []);
  assert.equal(sys.graph.dateProvider, new Graph().dateProvider);
  // and an ordinary graph runs untouched
  const g = new Graph();
  const p = new Pair(g, null, false);
  g.action(() => { p.addToGraph(); p.a.addToGraph(); p.b.addToGraph(); });
  p.a.count.updateWithAction(2);
  assert.equal(p.a.doubled.value, 4);
});

test('says so when setup() builds no graph it can see', () => {
  assert.throws(() => explore({ setup: () => ({}), actions: [], depth: 1 }), /ran no action on any graph.*pass it as `bg`/s);
});

test('a counterexample replays as a trace, one labelled event per step', () => {
  const opts = options(2, true, 10);
  const r = explore(opts);
  const replay = traceCounterexample(opts, r.counterexample.steps);
  assert.equal(replay.failedAt, 2);
  const [data] = replay.traces;
  assert.deepEqual(data.traces.map((t) => t.source).slice(-2), ['step 1: incA', 'step 2: incA']);
  const text = explain(data);
  assert.match(text, /step 2: incA[\s\S]*count = 2[\s\S]*doubled = 5[\s\S]*ERROR: a.doubled is odd: 5/);
});

test('the search example: explore finds the stale reply, the trace shows it', async () => {
  const spec = (await import('../examples/search.mjs')).default;
  const r = explore(spec);
  assert.deepEqual(r.counterexample.steps.map((s) => s.input), ['ca', 'cat', 'newest', 'oldest']);
  const text = explain(traceCounterexample(spec, r.counterexample.steps).traces[0]);
  assert.match(text, /Event 5: reply to "ca"\n.*\n {2}1\. sets results {2}\(because reply changed\)\n {6}updates results = \["ca-1", "ca-2"\]/);
});
