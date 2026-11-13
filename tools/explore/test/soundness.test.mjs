// Regression tests for holes where explore reported "no violation" although a failing sequence
// existed within the depth. Each spec is small; each asserts that the full search finds the
// violation and that the reduction or option under test either finds it too or fails loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bg from 'behavior-graph';
import { explore, replayExplore, exploreLateEvents } from '../src/index.js';

const { Extent, Graph } = bg;
const here = dirname(fileURLToPath(import.meta.url));

/** Asserts that both 'none' and 'sleep' find a violation. */
function bothFind(spec) {
  const none = explore({ ...spec, reduction: 'none' });
  assert.equal(none.ok, false, 'the full search finds it');
  const sleep = explore({ ...spec, reduction: 'sleep' });
  assert.equal(sleep.ok, false, 'sleep sets find it too');
  assert.equal(sleep.counterexample.steps.length, none.counterexample.steps.length);
  return { none, sleep };
}

class XY extends Extent {
  constructor(g, x0 = 0) {
    super(g);
    this.x = this.state(x0);
    this.y = this.state(0);
  }
}

const xySetup = (x0) => () => { const e = new XY(new Graph(), x0); e.addToGraphWithAction(); return e; };

// --- 1. sleep-set footprints

test('1a: reads made by enabled() are part of the footprint', () => {
  bothFind({
    setup: xySetup(0),
    actions: [
      { name: 'A', enabled: (e) => e.x.value === 0, run: (e) => e.x.updateWithAction(5) },
      { name: 'B', enabled: (e) => e.x.value === 0, run: (e) => e.y.updateWithAction(7) },
    ],
    checks: [(e) => (e.x.value === 5 && e.y.value === 7 ? 'x=5 and y=7' : undefined)],
    depth: 2,
  });
});

test('1b: a same-value State.update reads and writes the state', () => {
  const { sleep } = bothFind({
    setup: xySetup(1),
    actions: [
      { name: 'A', run: (e) => e.x.updateWithAction(1) },
      { name: 'B', run: (e) => e.x.graph.action(() => { e.x.update(2); e.y.update(e.y.value + 1); }) },
    ],
    checks: [(e) => (e.x.value === 1 && e.y.value === 1 ? 'x=1 and y=1' : undefined)],
    depth: 2,
  });
  assert.deepEqual(sleep.counterexample.steps.map((s) => s.action), ['B', 'A']);
});

test('1c: writes to plain extent fields are part of the footprint', () => {
  class Modes extends Extent {
    constructor(g) { super(g); this.mode = 'none'; this.n = 0; }
  }
  bothFind({
    setup: () => { const e = new Modes(new Graph()); e.addToGraphWithAction(); return e; },
    actions: [
      { name: 'A', run: (e) => { e.mode = 'a'; } },
      { name: 'B', run: (e) => { e.mode = 'b'; e.n++; } },
    ],
    checks: [(e) => (e.mode === 'a' && e.n === 1 ? 'mode a after b' : undefined)],
    depth: 2,
  });
});

test('1d: envKey state is part of the footprint without exploreTouch', () => {
  class Pusher extends Extent {
    constructor(g, name, env) {
      super(g);
      this.env = env;
      this.go = this.moment();
      this.behavior().demands(this.go).runs((ext) => ext.sideEffect(() => ext.env.pending.push(name)));
    }
  }
  bothFind({
    setup: () => {
      const env = { pending: [] };
      const g = new Graph();
      const a = new Pusher(g, 'a', env), b = new Pusher(g, 'b', env);
      g.action(() => { a.addToGraph(); b.addToGraph(); });
      return { env, a, b };
    },
    actions: [
      { name: 'goA', enabled: (s) => !s.env.pending.includes('a'), run: (s) => s.a.go.updateWithAction() },
      { name: 'goB', enabled: (s) => !s.env.pending.includes('b'), run: (s) => s.b.go.updateWithAction() },
    ],
    envKey: (s) => s.env.pending,
    opaque: (v) => 'pending' in v,
    checks: [(s) => (s.env.pending.join(',') === 'b,a' ? 'b before a' : undefined)],
    depth: 2,
  });
});

test('1: sleep sets still reduce steps that touch only disjoint graph resources', () => {
  const spec = {
    setup: xySetup(0),
    actions: [
      { name: 'incX', run: (e) => e.x.updateWithAction((e.x.value + 1) % 3) },
      { name: 'incY', run: (e) => e.y.updateWithAction((e.y.value + 1) % 3) },
    ],
    depth: 8,
  };
  const none = explore(spec);
  const sleep = explore({ ...spec, reduction: 'sleep' });
  assert.equal(sleep.stats.states, none.stats.states);
  assert.ok(sleep.stats.slept > 0);
});

// --- 2. cone of influence

class Gate extends Extent {
  constructor(g) {
    super(g);
    this.gate = this.state(false);
    this.p = this.state(false);
    this.q = this.state(0);
  }
}
const gateSetup = () => { const e = new Gate(new Graph()); e.addToGraphWithAction(); return e; };

test('2: the cone fails loudly when enabled() reads outside it', () => {
  const spec = {
    setup: gateSetup,
    actions: [
      { name: 'open', run: (e) => e.gate.updateWithAction(true) },
      { name: 'fire', enabled: (e) => e.gate.value, run: (e) => e.p.updateWithAction(true) },
    ],
    checks: [(e) => (e.p.value ? 'p is set' : undefined)],
    depth: 3,
  };
  assert.equal(explore(spec).ok, false);
  assert.throws(() => explore({ ...spec, cone: (e) => [e.p] }), /outside the cone.*Gate\.gate/s);
});

test('2: the cone fails loudly when an action reads outside it', () => {
  const spec = {
    setup: gateSetup,
    actions: [
      { name: 'incQ', run: (e) => e.q.updateWithAction(Math.min(e.q.value + 1, 3)) },
      { name: 'setP', run: (e) => e.p.graph.action(() => e.p.update(e.q.value >= 2)) },
    ],
    checks: [(e) => (e.p.value ? 'p is set' : undefined)],
    depth: 3,
  };
  assert.equal(explore(spec).ok, false);
  assert.throws(() => explore({ ...spec, cone: (e) => [e.p] }), /outside the cone.*Gate\.q/s);
});

test('2: the cone fails loudly when a check reads outside it', () => {
  assert.throws(() => explore({
    setup: gateSetup,
    actions: [{ name: 'incQ', run: (e) => e.q.updateWithAction(Math.min(e.q.value + 1, 3)) }],
    checks: [(e) => (e.p.value && e.gate.value ? 'both' : undefined)],
    cone: (e) => [e.q],
    depth: 2,
  }), /outside the cone.*Gate\.p/s);
});

// --- 3. and 4. finding every graph setup() builds

test('3: a graph built in setup() but first acted on in a step is explored', () => {
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); } }
  const r = explore({
    setup: () => {
      const g1 = new Graph(), g2 = new Graph();
      const u = new V(g1);
      u.addToGraphWithAction();
      return { g2, ext: null };
    },
    actions: [
      { name: 'add', enabled: (s) => s.ext === null, run: (s) => { s.ext = new V(s.g2); s.ext.addToGraphWithAction(); } },
      { name: 'inc', enabled: (s) => s.ext !== null, run: (s) => s.ext.v.updateWithAction(s.ext.v.value + 1) },
    ],
    checks: [(s) => (s.ext !== null && s.ext.v.value >= 2 ? 'v reached 2' : undefined)],
    depth: 4,
  });
  assert.equal(r.ok, false);
  assert.equal(r.counterexample.steps.length, 3);
});

test('3: an extent built in setup() on a graph that setup() never acts on is explored', () => {
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); } }
  const r = explore({
    setup: () => {
      const u = new V(new Graph());
      u.addToGraphWithAction();
      return { later: new V(new Graph()) };
    },
    actions: [
      { name: 'add', enabled: (s) => !s.later.addedToGraph.value, run: (s) => s.later.addToGraphWithAction() },
      { name: 'inc', enabled: (s) => s.later.addedToGraph.value, run: (s) => s.later.v.updateWithAction(s.later.v.value + 1) },
    ],
    checks: [(s) => (s.later.v.value >= 2 ? 'v reached 2' : undefined)],
    depth: 4,
  });
  assert.equal(r.ok, false);
});

test('3: a graph created during a step is an error', () => {
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); } }
  assert.throws(() => explore({
    setup: () => { const u = new V(new Graph()); u.addToGraphWithAction(); return u; },
    actions: [{ name: 'spawn', run: () => { const w = new V(new Graph()); w.addToGraphWithAction(); } }],
    depth: 1,
  }), /graph that setup\(\) did not build/);
});

test('3: a graph shared between systems is an error', () => {
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); } }
  const shared = new Graph();
  assert.throws(() => explore({
    setup: () => { const u = new V(shared); u.addToGraphWithAction(); return u; },
    actions: [{ name: 'inc', run: (u) => u.v.updateWithAction((u.v.value + 1) % 2) }],
    depth: 2,
  }), /earlier system/);
});

test('4: actionAsync in setup() registers the graph', () => {
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); } }
  const r = explore({
    setup: () => {
      const g = new Graph();
      const a = new V(g), b = new V(g);
      g.actionAsync(() => a.addToGraph());
      g.action(() => b.addToGraph());
      return { a, b };
    },
    actions: [{ name: 'incA', run: (s) => s.a.v.updateWithAction(s.a.v.value + 1) }],
    checks: [(s) => (s.a.v.value >= 2 ? 'a.v reached 2' : undefined)],
    depth: 3,
  });
  assert.equal(r.ok, false);
  assert.equal(r.counterexample.steps.length, 2);
});

// --- 5. state the hasher could not see

test('5: symbol-keyed fields are hashed', () => {
  const k = Symbol('count');
  class S extends Extent { constructor(g) { super(g); this[k] = 0; } }
  const r = explore({
    setup: () => { const e = new S(new Graph()); e.addToGraphWithAction(); return e; },
    actions: [{ name: 'inc', run: (e) => { e[k] = Math.min(e[k] + 1, 5); } }],
    checks: [(e) => (e[k] >= 3 ? 'reached 3' : undefined)],
    depth: 5,
  });
  assert.equal(r.ok, false);
  assert.equal(r.counterexample.steps.length, 3);
});

test('5: an extent not yet added to its graph is hashed structurally', () => {
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); this.n = 0; } }
  class Holder extends Extent { constructor(g) { super(g); this.spare = new V(g); } }
  const r = explore({
    setup: () => { const h = new Holder(new Graph()); h.addToGraphWithAction(); return h; },
    actions: [{ name: 'inc', run: (h) => { h.spare.n = Math.min(h.spare.n + 1, 5); } }],
    checks: [(h) => (h.spare.n >= 3 ? 'reached 3' : undefined)],
    depth: 5,
  });
  assert.equal(r.ok, false);
});

test('5: an extent of an untracked graph reachable from the state is an error', () => {
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); } }
  const stray = new V(new Graph());
  assert.throws(() => explore({
    setup: () => { const u = new V(new Graph()); u.addToGraphWithAction(); return u; },
    actions: [{ name: 'noop', run: () => {} }],
    envKey: () => ({ stray }),
    depth: 1,
  }), /graph explore does not track/);
});

test('5: a Graph or Extent from another copy of behavior-graph is an error', () => {
  // an object shaped like a graph and an extent, but not from the module explore uses
  const foreignGraph = { activatedBehaviors: {}, eventLoopState: null, dateProvider: {} };
  const foreignExtent = { graph: foreignGraph, resources: [], behaviors: [], addedToGraph: {} };
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); } }
  assert.throws(() => explore({
    setup: () => { const u = new V(new Graph()); u.addToGraphWithAction(); return { u, other: foreignExtent }; },
    actions: [{ name: 'noop', run: () => {} }],
    depth: 1,
  }), /another copy of behavior-graph/);
});

// --- 6. async work

test('6: a run that returns a promise is an error', () => {
  class V extends Extent { constructor(g) { super(g); this.v = this.state(0); } }
  assert.throws(() => explore({
    setup: () => { const u = new V(new Graph()); u.addToGraphWithAction(); return u; },
    actions: [{ name: 'later', run: async (u) => { u.v.updateWithAction(1); } }],
    depth: 1,
  }), /returned a promise/);
});

test('6: a run may return the promise of the action it started', () => {
  const r = explore({
    setup: xySetup(0),
    actions: [{ name: 'inc', run: (e) => e.x.graph.actionAsync(() => e.x.update(Math.min(e.x.value + 1, 2))) },
      { name: 'incY', run: (e) => e.actionAsync((ext) => ext.y.update(Math.min(ext.y.value + 1, 2))) }],
    checks: [(e) => (e.x.value === 2 && e.y.value === 2 ? 'both 2' : undefined)],
    depth: 4,
  });
  assert.equal(r.ok, false);
  assert.equal(r.counterexample.steps.length, 4);
});

test('6: a side effect that continues in a promise is an error', () => {
  class V extends Extent {
    constructor(g) {
      super(g);
      this.go = this.moment();
      this.v = this.state(0);
      this.behavior().demands(this.go).runs((ext) => ext.sideEffect(() => {
        Promise.resolve().then(() => ext.v.updateWithAction(1));
      }));
    }
  }
  assert.throws(() => explore({
    setup: () => { const u = new V(new Graph()); u.addToGraphWithAction(); return u; },
    actions: [{ name: 'go', run: (u) => u.go.updateWithAction() }],
    checks: [(u) => (u.v.value === 1 ? 'v set' : undefined)],
    depth: 2,
  }), /async/);
});

test('6: an async side effect block is an error', () => {
  class V extends Extent {
    constructor(g) {
      super(g);
      this.go = this.moment();
      this.behavior().demands(this.go).runs((ext) => ext.sideEffect(async () => {}));
    }
  }
  assert.throws(() => explore({
    setup: () => { const u = new V(new Graph()); u.addToGraphWithAction(); return u; },
    actions: [{ name: 'go', run: (u) => u.go.updateWithAction() }],
    depth: 1,
  }), /returned a promise/);
});

test('6: an action after an await in a side effect is counted, and the CLI fails on it', async () => {
  const spec = (await import('./fixtures/await-in-effect.mjs')).default;
  exploreLateEvents();
  const r = explore(spec);
  assert.equal(r.ok, true); // the search cannot see the continuation...
  await new Promise((res) => setTimeout(res, 0));
  assert.ok(exploreLateEvents() > 0); // ...but it is counted once it runs
  const out = cli([join(here, 'fixtures/await-in-effect.mjs')]);
  assert.equal(out.status, 2, out.stdout + out.stderr);
  assert.match(out.stderr, /after their step had returned/);
});

// --- 8. the starting state

test('8: checks run on the state setup() builds', () => {
  const opts = {
    setup: xySetup(9),
    actions: [{ name: 'inc', run: (e) => e.y.updateWithAction(e.y.value + 1) }],
    checks: [(e, ctx) => (e.x.value === 9 ? `x is 9 at depth ${ctx.depth}` : undefined)],
    depth: 2,
  };
  for (const mode of ['bfs', 'random']) {
    const r = explore({ ...opts, mode });
    assert.equal(r.ok, false);
    assert.deepEqual(r.counterexample.steps, []);
    assert.deepEqual(r.counterexample.violations, ['x is 9 at depth 0']);
  }
  const replay = replayExplore(opts, []);
  assert.equal(replay.failedAt, 0);
});

// --- 9. nondeterminism

test('9: Date.now, new Date() and Math.random throw in side effects and actions too', () => {
  class V extends Extent {
    constructor(g, read) {
      super(g);
      this.go = this.moment();
      this.behavior().demands(this.go).runs((ext) => ext.sideEffect(() => { ext.seen = read(); }));
    }
  }
  const reads = { 'Date.now': () => Date.now(), 'new Date': () => new Date(), 'Math.random': () => Math.random() };
  for (const [name, read] of Object.entries(reads)) {
    const r = explore({
      setup: () => { const u = new V(new Graph(), read); u.addToGraphWithAction(); return u; },
      actions: [{ name: 'go', run: (u) => u.go.updateWithAction() }],
      depth: 1,
    });
    assert.equal(r.ok, false, name);
    assert.match(r.counterexample.violations[0], /not replayable/, name);
  }
  // an action that reads the clock outside any event
  const r = explore({
    setup: xySetup(0),
    actions: [{ name: 'stamp', run: (e) => e.y.updateWithAction(Date.now()) }],
    depth: 1,
  });
  assert.match(r.counterexample.violations[0], /Date.now\(\) is not replayable.*dateProvider/s);
  // dates built from a value are fine, and events still get timestamps
  const ok = explore({
    setup: xySetup(0),
    actions: [{ name: 'at', run: (e) => e.y.updateWithAction(new Date(5).getTime() + e.x.graph.lastEvent.timestamp.getTime()) }],
    depth: 2,
  });
  assert.equal(ok.ok, true);
  assert.equal(typeof Date.now(), 'number');
  assert.ok(new Date() instanceof Date);
});

// --- 7. the CLI

function cli(args, env = {}) {
  return spawnSync(process.execPath, [join(here, '../bin/bg-explore.js'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}
const search = join(here, '../examples/search.mjs');

test('7: the CLI rejects bad flags with exit 2', () => {
  for (const args of [['--depth', 'abc'], ['--depth', '-1'], ['--depth', '2.5'], ['--walks', 'x'], ['--mode', 'randm'],
    ['--reduction', 'slep'], ['--max-states', '0'], ['--seed', 'q'], ['--depht', '3'], ['--depth']]) {
    const r = cli([search, ...args]);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /usage|must be|unknown/i, args.join(' '));
  }
});

test('7: a truncated search exits 3 and says it is not a pass', () => {
  const r = cli([search, '--max-states', '5'], { FIXED: '1' });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /TRUNCATED/);
  assert.match(r.stdout, /not a pass/);
});

test('7: the CLI reports a violation in the starting state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bg-explore-'));
  const spec = join(dir, 'start.mjs');
  writeFileSync(spec, `import * as bg from ${JSON.stringify(import.meta.resolve('behavior-graph'))};
class V extends bg.Extent { constructor(g) { super(g); this.v = this.state(1); } }
export default { bg, setup: () => { const v = new V(new bg.Graph()); v.addToGraphWithAction(); return v; },
  actions: [], checks: [(v) => v.v.value === 1 ? 'starts at 1' : undefined], depth: 2 };`);
  const r = cli([spec, '--no-trace']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /starting state/);
  assert.match(r.stdout, /starts at 1/);
});

test('the search example is unchanged: 4-step counterexample, 81 states when fixed', () => {
  const r = cli([search, '--no-trace']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Violation after 4 step/);
  const f = cli([search], { FIXED: '1' });
  assert.equal(f.status, 0, f.stdout + f.stderr);
  assert.match(f.stdout, /81 states, 138 transitions, depth 6 of 6/);
});
