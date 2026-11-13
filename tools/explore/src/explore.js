// A bounded model checker for behavior graphs.
//
// `explore()` runs the real graph over every sequence of inputs up to a depth, breadth first,
// and checks properties after each step. A graph's events are deterministic, so the only
// nondeterminism is the order and choice of inputs, and the checker needs no model: it runs
// your code.
//
// - Stateless replay. There is no snapshot or restore. Each branch builds a fresh system with
//   `setup()` and replays its input prefix, as CHESS and VeriSoft do.
// - Visited-state hashing. After each step the state of every live extent (State values and
//   plain fields) plus the caller's `envKey` is hashed. A state seen before is not expanded again.
// - Properties. A step that throws is a violation, so an invariant can be a behavior that
//   demands what it checks and throws. `checks` run after each step for properties over the
//   whole system (the environment, outputs).
// - Counterexamples are input sequences. `replayExplore` runs one in a fresh system.
// - Reductions from declared dependencies: `cone` hashes only the resources upstream of a
//   property (cone of influence), and `reduction: "sleep"` skips orderings of steps whose
//   footprints are disjoint (partial order reduction with sleep sets).
// - Random walks (`mode: "random"`) when the space is too big.
//
// Bounded search is not proof: it is exhaustive testing up to `depth` over the given inputs.
//
// This is a development tool, not part of the library. While it runs it wraps a few methods on
// the library's prototypes (to find the graphs `setup()` builds and to watch reads, writes and
// structure changes) and puts them back when it returns. Pass the `behavior-graph` module your
// code imports as `bg` if it is not the copy this package resolves.

import * as defaultBg from 'behavior-graph';

/**
 * @template S
 * @typedef {object} ExploreAction One kind of input, with a small finite domain (like TLC constants).
 * @property {string} name
 * @property {readonly any[]} [inputs] The inputs to try. Omit for an action without one.
 * @property {(sys: S, input: any) => boolean} [enabled] Skip an input in this state. Must be deterministic.
 * @property {(sys: S, input: any) => void} run Deliver the input, normally with one or more graph actions.
 */

/**
 * @typedef {{ action: string, input?: unknown }} ExploreStep One step of an input sequence.
 * @typedef {{ step: ExploreStep, depth: number }} CheckContext `depth` is the step's 1-based position.
 * @typedef {{ updated: string[], behaviors: string[] }} Provenance Resources the failing step
 *   updated (`Extent.resource`) and behaviors that ran in it (by what they supply).
 * @typedef {{ steps: ExploreStep[], violations: string[], provenance: Provenance }} Counterexample
 * @typedef {{ states: number, transitions: number, stepsRun: number, slept: number,
 *   depthCompleted: number, truncated: boolean, ms: number }} ExploreStats
 * @typedef {{ ok: boolean, counterexample?: Counterexample, stats: ExploreStats }} ExploreResult
 */

/**
 * @template S
 * @typedef {object} ExploreOptions
 * @property {() => S} setup Builds a fresh system. Every graph it runs an action on is explored. Must be deterministic.
 * @property {ExploreAction<S>[]} actions
 * @property {number} depth Maximum number of steps in a sequence.
 * @property {((sys: S, ctx: CheckContext) => string | string[] | void | null | undefined | false)[]} [checks]
 *   Properties checked after every step; return a message (or several) when one fails. A step that throws is also a violation.
 * @property {(sys: S) => unknown} [envKey] State outside the graphs that affects what happens next: pending
 *   requests, armed timers, the clock. Anything a step reads that is not in a graph must be here, or two
 *   different states may be merged and a bug missed.
 * @property {(sys: S, graphs: any[]) => any[]} [cone] Cone of influence: the resources the properties read.
 *   Only these and the resources upstream of them (through declared demands) are hashed, and extents' plain
 *   fields are not. Sound only if the checks read nothing else and every side effect that feeds back into
 *   the graph depends only on the cone (or on `envKey`).
 * @property {(value: object) => boolean} [opaque] Values not to look inside when hashing extents' plain
 *   fields, such as the environment an extent holds a reference to (its state belongs in `envKey`).
 * @property {'none' | 'sleep'} [reduction] `"sleep"`: partial order reduction. Two steps whose footprints
 *   (resources read and written, declared demands of the behaviors that ran, keys passed to `exploreTouch`)
 *   are disjoint commute, so only one of their orders is explored. Sound for properties of states; a check
 *   that reads a step's outputs may miss the skipped orders.
 * @property {number} [maxStates] Stop after this many distinct states (`stats.truncated`). Default 1,000,000.
 * @property {'bfs' | 'random'} [mode] `"bfs"` (default) or `"random"` walks of length `depth`.
 * @property {number} [walks] Random mode: number of walks. Default 1000.
 * @property {number} [seed] Random mode: seed. Default 1.
 * @property {any} [bg] The `behavior-graph` module the system uses. Default: the one this package resolves.
 */

// ---------------------------------------------------------------------------------------------
// Hooks into the library, installed only while explore runs

/** Per graph: its extents in the order added, and the observer for the current step. */
const graphInfo = new WeakMap();
/** The graphs of the system being built, or null outside `build()`. */
let building = null;
let onGraphCreated = null;

function hooksFor(bg) {
  const { Graph, Resource, State } = bg;
  const G = Graph.prototype, R = Resource.prototype, St = State.prototype;
  const saved = {
    actionHelper: G.actionHelper, resourceTouched: G.resourceTouched, addExtent: G.addExtent,
    removeExtent: G.removeExtent, updateDemands: G.updateDemands, updateSupplies: G.updateSupplies,
    assertValidAccessor: R.assertValidAccessor, assertValidTraceAccessor: St.assertValidTraceAccessor,
  };
  for (const [k, v] of Object.entries(saved)) {
    if (typeof v !== 'function') throw new Error(`explore: this behavior-graph has no ${k}; the tool and the library are out of step`);
  }
  const observer = (g) => graphInfo.get(g)?.observer ?? null;

  G.actionHelper = function (...args) {
    if (building !== null && !graphInfo.has(this)) {
      register(this);
      // dispatch again so that anything onGraphCreated installed on the instance sees this action
      return this.actionHelper(...args);
    }
    return saved.actionHelper.apply(this, args);
  };
  G.resourceTouched = function (resource) {
    observer(this)?.write(resource);
    return saved.resourceTouched.call(this, resource);
  };
  G.addExtent = function (extent) {
    const r = saved.addExtent.call(this, extent);
    const info = graphInfo.get(this);
    if (info) { info.extents.add(extent); info.observer?.structureChanged(); }
    return r;
  };
  G.removeExtent = function (extent) {
    const r = saved.removeExtent.call(this, extent);
    const info = graphInfo.get(this);
    if (info) { info.extents.delete(extent); info.observer?.structureChanged(); }
    return r;
  };
  G.updateDemands = function (...args) {
    const r = saved.updateDemands.apply(this, args);
    observer(this)?.structureChanged();
    return r;
  };
  G.updateSupplies = function (...args) {
    const r = saved.updateSupplies.apply(this, args);
    observer(this)?.structureChanged();
    return r;
  };
  R.assertValidAccessor = function () {
    observer(this.graph)?.read(this);
    return saved.assertValidAccessor.call(this);
  };
  St.assertValidTraceAccessor = function () {
    observer(this.graph)?.read(this);
    return saved.assertValidTraceAccessor.call(this);
  };

  return () => {
    Object.assign(G, { actionHelper: saved.actionHelper, resourceTouched: saved.resourceTouched, addExtent: saved.addExtent,
      removeExtent: saved.removeExtent, updateDemands: saved.updateDemands, updateSupplies: saved.updateSupplies });
    R.assertValidAccessor = saved.assertValidAccessor;
    St.assertValidTraceAccessor = saved.assertValidTraceAccessor;
  };
}

function register(graph) {
  const info = { extents: new Set(), observer: null };
  graphInfo.set(graph, info);
  building.push(graph);
  // the event loop sets currentBehavior just before running each behavior
  let current = graph.currentBehavior;
  Object.defineProperty(graph, 'currentBehavior', {
    configurable: true,
    get: () => current,
    set: (b) => { current = b; if (b !== null) info.observer?.behaviorRan(b); },
  });
  onGraphCreated?.(graph);
}

const extentsOf = (g) => graphInfo.get(g)?.extents ?? new Set();

let hookDepth = 0;
let activeBg = null;
function withHooks(bg, fn) {
  if (hookDepth > 0) {
    if (bg !== activeBg) throw new Error('explore: already running with a different behavior-graph module');
    return fn();
  }
  const unhook = hooksFor(bg);
  const unguard = guardNondeterminism();
  hookDepth++; activeBg = bg;
  try {
    return fn();
  } finally {
    hookDepth--; activeBg = null;
    unguard(); unhook();
  }
}

// ---------------------------------------------------------------------------------------------
// Environment footprints

let currentFootprint = null;

/**
 * Records that the current step reads or writes something outside the graph (a service queue,
 * the clock), for `reduction: "sleep"`. Does nothing outside `explore()`. Call it from the
 * environment code your actions and side effects use.
 * @param {string} key
 * @param {'read' | 'write' | 'readwrite'} mode
 */
export function exploreTouch(key, mode) {
  if (currentFootprint === null) return;
  if (mode !== 'write') currentFootprint.reads.add('env:' + key);
  if (mode !== 'read') currentFootprint.writes.add('env:' + key);
}

function independent(a, b) {
  if (a.structure || b.structure) return false;
  for (const w of a.writes) if (b.writes.has(w) || b.reads.has(w)) return false;
  for (const w of b.writes) if (a.reads.has(w)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Running steps

function build(opts) {
  const previous = building;
  building = [];
  const graphs = building;
  try {
    const sys = opts.setup();
    if (graphs.length === 0) {
      throw new Error("explore: setup() ran no action on any graph. Add the system's extents with an action " +
        '(addToGraphWithAction), and if your code imports a different copy of behavior-graph than this tool, pass it as `bg`.');
    }
    return { sys, graphs };
  } finally {
    building = previous;
  }
}

function actionByName(opts) {
  const m = new Map();
  for (const a of opts.actions) {
    if (m.has(a.name)) throw new Error(`explore: two actions named ${a.name}`);
    m.set(a.name, a);
  }
  return m;
}

const errString = (e) => (e instanceof Error ? e.message : String(e));

/** Canonical names for resources (`<graph>.<extent>.<resource>`), stable for one state. */
function resourceKeys(graphs) {
  const keys = new Map();
  graphs.forEach((g, gi) => {
    let ei = 0;
    for (const ext of extentsOf(g)) {
      ext.resources.forEach((r, ri) => keys.set(r, `${gi}.${ei}.${ri}`));
      ei++;
    }
  });
  return keys;
}

/** Runs one step in `b` and checks it, recording what it touched. */
function runStep(opts, actions, b, step, depth, record) {
  const footprint = { reads: new Set(), writes: new Set(), structure: false };
  const provenance = { updated: [], behaviors: [] };
  const keys = record ? resourceKeys(b.graphs) : null;
  const keyOf = (r) => keys.get(r) ?? 'new:' + (r.debugName ?? '?');
  const observer = record ? {
    read: (r) => { footprint.reads.add(keyOf(r)); },
    write: (r) => { footprint.writes.add(keyOf(r)); provenance.updated.push(describeResource(r)); },
    behaviorRan: (bh) => {
      bh.demands?.forEach((d) => footprint.reads.add(keyOf(d)));
      bh.traceDemands?.forEach((d) => footprint.reads.add(keyOf(d)));
      provenance.behaviors.push(describeBehavior(bh));
    },
    structureChanged: () => { footprint.structure = true; },
  } : null;
  const violations = [];
  const action = actions.get(step.action);
  if (action === undefined) throw new Error(`explore: no action named ${step.action}`);
  for (const g of b.graphs) graphInfo.get(g).observer = observer;
  activeGraphs = b.graphs;
  const previousFootprint = currentFootprint;
  currentFootprint = record ? footprint : null;
  try {
    action.run(b.sys, step.input);
  } catch (e) {
    violations.push(`threw: ${errString(e)}`);
  } finally {
    currentFootprint = previousFootprint;
    activeGraphs = [];
    for (const g of b.graphs) graphInfo.get(g).observer = null;
  }
  if (violations.length === 0 && record) {
    for (const check of opts.checks ?? []) {
      try {
        const r = check(b.sys, { step, depth });
        if (typeof r === 'string') violations.push(r);
        else if (Array.isArray(r)) violations.push(...r);
      } catch (e) {
        violations.push(`check threw: ${errString(e)}`);
      }
    }
  }
  return { violations, footprint, provenance };
}

function describeResource(r) {
  const ext = r.extent?.debugName ?? r.extent?.constructor?.name ?? '?';
  return `${ext}.${r.debugName ?? '?'}`;
}

function describeBehavior(b) {
  const ext = b.extent?.debugName ?? b.extent?.constructor?.name ?? '?';
  const supplies = b.supplies ? [...b.supplies].map((r) => r.debugName ?? '?') : [];
  return supplies.length > 0 ? `${ext}: supplies ${supplies.join(', ')}` : `${ext}: (no supplies)`;
}

function replayPrefix(opts, actions, prefix) {
  const b = build(opts);
  for (let i = 0; i < prefix.length; i++) {
    const out = runStep(opts, actions, b, prefix[i], i + 1, false);
    if (out.violations.length > 0) {
      throw new Error(`explore: replay of a passing prefix failed at step ${i + 1} (${out.violations[0]}); is setup() deterministic?`);
    }
  }
  return b;
}

function enabledSteps(opts, b) {
  const steps = [];
  for (const a of opts.actions) {
    if (a.inputs === undefined) {
      if (a.enabled === undefined || a.enabled(b.sys, undefined)) steps.push({ action: a.name });
    } else {
      for (const input of a.inputs) {
        if (a.enabled === undefined || a.enabled(b.sys, input)) steps.push({ action: a.name, input });
      }
    }
  }
  return steps;
}

/** A step as one line: `name` or `name <input as JSON>`. */
export function stepKey(s) {
  return s.input === undefined ? s.action : s.action + ' ' + JSON.stringify(s.input);
}

/**
 * Replays `steps` in a fresh system and returns it, with the violations of the first step that
 * had any. Use it to turn a counterexample into a debugging session. `onGraph` is called with
 * each graph `setup()` uses, before its first action runs (to attach a tracer, for example).
 * @template S
 * @param {ExploreOptions<S>} opts
 * @param {ExploreStep[]} steps
 * @param {{ onGraph?: (graph: any) => void, onStep?: (step: ExploreStep, index: number, run: () => void) => void }} [hooks]
 *   `onStep` wraps each step's run, so a caller can label the events it starts.
 * @returns {{ sys: S, violations: string[], failedAt?: number }}
 */
export function replayExplore(opts, steps, hooks = {}) {
  return withHooks(opts.bg ?? defaultBg, () => {
    const actions = actionByName(opts);
    const previous = onGraphCreated;
    onGraphCreated = hooks.onGraph ?? null;
    let b;
    try {
      b = build(opts);
    } finally {
      onGraphCreated = previous;
    }
    for (let i = 0; i < steps.length; i++) {
      let out;
      const run = () => { out = runStep(opts, actions, b, steps[i], i + 1, true); };
      if (hooks.onStep) hooks.onStep(steps[i], i, run); else run();
      if (out.violations.length > 0) return { sys: b.sys, violations: out.violations, failedAt: i + 1 };
    }
    return { sys: b.sys, violations: [] };
  });
}

// ---------------------------------------------------------------------------------------------
// State hashing

/** Fields every Extent has; not part of its state. */
const extentBaseFields = new Set(['debugConstructorName', 'debugName', 'behaviors', 'resources', 'graph', 'addedToGraphWhen',
  'removedFromGraphWhen', 'lifetime', 'unsubscribes', 'addedToGraph', 'onRemoves']);

class Canon {
  constructor(bg, graphs, opaque) {
    this.bg = bg;
    this.opaque = opaque;
    this.extentIds = new Map();
    this.resourceIds = new Map();
    this.seen = new Set();
    let ei = 0;
    for (const g of graphs) {
      for (const ext of extentsOf(g)) {
        this.extentIds.set(ext, ei);
        ext.resources.forEach((r, ri) => this.resourceIds.set(r, `${ei}.${ri}`));
        ei++;
      }
    }
  }

  value(v) {
    switch (typeof v) {
      case 'undefined': return 'u';
      case 'number': return 'n' + String(v);
      case 'string': return JSON.stringify(v);
      case 'boolean': return v ? 'T' : 'F';
      case 'bigint': return 'b' + String(v);
      case 'symbol': return 'y' + String(v);
      case 'function': return 'f';
    }
    if (v === null) return 'N';
    const { Extent, Resource, Behavior, Graph } = this.bg;
    const o = v;
    if (o instanceof Extent) {
      const id = this.extentIds.get(o);
      return id === undefined ? `@X${o.constructor.name}` : `@E${id}`;
    }
    if (o instanceof Resource) return `@R${this.resourceIds.get(o) ?? '?'}`;
    if (o instanceof Behavior || o instanceof Graph) return '@B';
    if (this.opaque?.(o)) return '@opaque';
    if (this.seen.has(o)) return '@cycle';
    this.seen.add(o);
    try {
      if (Array.isArray(o)) return '[' + o.map((x) => this.value(x)).join(',') + ']';
      if (o instanceof Map) return 'M{' + [...o].map(([k, x]) => this.value(k) + ':' + this.value(x)).join(',') + '}';
      if (o instanceof Set) return 'S{' + [...o].map((x) => this.value(x)).join(',') + '}';
      if (o instanceof Date) return 'D' + o.getTime();
      const keys = Object.keys(o).sort();
      return (o.constructor?.name ?? '') + '{' + keys.map((k) => JSON.stringify(k) + ':' + this.value(o[k])).join(',') + '}';
    } finally {
      this.seen.delete(o);
    }
  }

  stateOf(r) {
    if (r instanceof this.bg.State) return this.value(r.currentState.value);
    // Moments reset at the end of every event; between steps they hold nothing.
    if (r instanceof this.bg.Moment) return 'm';
    return 'r';
  }

  extent(ext, only) {
    const parts = [ext.constructor.name];
    ext.resources.forEach((r, ri) => {
      if (only === null || only.has(r)) parts.push(`${ri}=${this.stateOf(r)}`);
    });
    if (only === null) {
      const resources = new Set(ext.resources);
      for (const k of Object.keys(ext).sort()) {
        if (extentBaseFields.has(k)) continue;
        const field = ext[k];
        if (resources.has(field) || typeof field === 'function') continue;
        parts.push(`${k}:${this.value(field)}`);
      }
    }
    return parts.join('|');
  }
}

/** The resources upstream of `roots`: their suppliers' demands, trace demands and other supplies. */
function coneOf(roots) {
  const cone = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const r = queue.pop();
    if (cone.has(r)) continue;
    cone.add(r);
    const supplier = r.suppliedBy;
    if (supplier == null) continue;
    supplier.demands?.forEach((d) => queue.push(d));
    supplier.traceDemands?.forEach((d) => queue.push(d));
    // a supplier may read the current value of anything it supplies without demanding it
    supplier.supplies?.forEach((d) => queue.push(d));
  }
  return cone;
}

function stateString(opts, b) {
  const canon = new Canon(opts.bg ?? defaultBg, b.graphs, opts.opaque);
  const only = opts.cone ? coneOf(opts.cone(b.sys, b.graphs)) : null;
  const parts = [];
  for (const g of b.graphs) {
    for (const ext of extentsOf(g)) parts.push(canon.extent(ext, only));
    parts.push('/');
  }
  if (opts.envKey) parts.push('env:' + canon.value(opts.envKey(b.sys)));
  return parts.join('\n');
}

/** 106-bit string hash (two 53-bit cyrb53 lanes). */
function hash(s) {
  const lane = (seed) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  return lane(0) + ':' + lane(0x9e3779b9) + ':' + s.length.toString(36);
}

// ---------------------------------------------------------------------------------------------
// Search

/**
 * Explores every input sequence up to `opts.depth`. See the comment at the top of this file.
 * @template S
 * @param {ExploreOptions<S>} opts
 * @returns {ExploreResult}
 */
export function explore(opts) {
  return withHooks(opts.bg ?? defaultBg, () => ((opts.mode ?? 'bfs') === 'random' ? randomWalks(opts) : bfs(opts)));
}

/** Graphs of the system being stepped, for the nondeterminism guard. */
let activeGraphs = [];

/**
 * While explore runs, `Date.now()` and `Math.random()` throw inside a behavior: their results
 * would differ on replay and the search would silently merge or miss states. Read time from
 * `graph.dateProvider` or an injected clock, and randomness from an input.
 */
function guardNondeterminism() {
  const now = Date.now;
  const random = Math.random;
  const inBehavior = () => activeGraphs.some((g) => g.currentBehavior != null);
  Date.now = () => {
    if (inBehavior()) throw new Error('explore: Date.now() inside a behavior is not replayable; use graph.dateProvider or an injected clock');
    return now();
  };
  Math.random = () => {
    if (inBehavior()) throw new Error('explore: Math.random() inside a behavior is not replayable; pass randomness in as an input');
    return random();
  };
  return () => {
    Date.now = now;
    Math.random = random;
  };
}

function bfs(opts) {
  const start = Date.now();
  const actions = actionByName(opts);
  const maxStates = opts.maxStates ?? 1_000_000;
  const sleepOn = opts.reduction === 'sleep';
  const stats = { states: 0, transitions: 0, stepsRun: 0, slept: 0, depthCompleted: 0, truncated: false, ms: 0 };
  const finish = (r) => {
    stats.ms = Date.now() - start;
    return { ...r, stats };
  };

  const root = build(opts);
  const visited = new Map();
  const rootHash = hash(stateString(opts, root));
  visited.set(rootHash, sleepOn ? new Set() : null);
  stats.states = 1;
  let frontier = [{ prefix: [], sleep: new Map(), only: null, hash: rootHash }];

  for (let depth = 1; depth <= opts.depth; depth++) {
    const next = [];
    // nodes queued for the next level by state, so a revisit can shrink their sleep set in place
    const queued = new Map();
    for (const node of frontier) {
      const here = replayPrefix(opts, actions, node.prefix);
      stats.stepsRun += node.prefix.length;
      if (hash(stateString(opts, here)) !== node.hash) {
        throw new Error(`explore: replaying ${node.prefix.length} step(s) reached a different state than the first run. Something is not deterministic: setup(), a step, Date or randomness, or state outside the graphs that envKey does not cover.`);
      }
      const candidates = enabledSteps(opts, here);
      // footprints of the siblings already taken from this node, for their sleep sets
      const done = new Map();
      let fresh = here;
      for (const step of candidates) {
        const key = stepKey(step);
        if (node.only !== null && !node.only.has(key)) continue;
        if (node.sleep.has(key)) {
          stats.slept++;
          continue;
        }
        const b = fresh ?? replayPrefix(opts, actions, node.prefix);
        if (fresh === null) stats.stepsRun += node.prefix.length;
        fresh = null;
        const out = runStep(opts, actions, b, step, depth, true);
        stats.transitions++;
        stats.stepsRun++;
        const prefix = [...node.prefix, step];
        if (out.violations.length > 0) {
          return finish({ ok: false, counterexample: { steps: prefix, violations: out.violations, provenance: out.provenance } });
        }
        const childSleep = new Map();
        if (sleepOn) {
          for (const [k, f] of node.sleep) if (independent(f, out.footprint)) childSleep.set(k, f);
          for (const [k, f] of done) if (independent(f, out.footprint)) childSleep.set(k, f);
          done.set(key, out.footprint);
        }
        const h = hash(stateString(opts, b));
        if (!visited.has(h)) {
          stats.states++;
          visited.set(h, sleepOn ? new Set(childSleep.keys()) : null);
          if (depth < opts.depth) {
            const child = { prefix, sleep: childSleep, only: null, hash: h };
            next.push(child);
            queued.set(h, child);
          }
          if (stats.states >= maxStates) {
            stats.truncated = true;
            return finish({ ok: true });
          }
        } else if (sleepOn) {
          // Seen before with sleep set `old`: steps in `old` but not in the new one were never
          // taken from that state. If its node is still queued, shrink its sleep set; otherwise
          // expand it again for just those steps.
          const old = visited.get(h);
          const missing = new Set();
          for (const k of old) if (!childSleep.has(k)) missing.add(k);
          if (missing.size > 0) {
            const meet = new Map();
            for (const [k, f] of childSleep) if (old.has(k)) meet.set(k, f);
            visited.set(h, new Set(meet.keys()));
            const pending = queued.get(h);
            if (pending !== undefined) {
              for (const k of missing) pending.sleep.delete(k);
            } else if (depth < opts.depth) {
              next.push({ prefix, sleep: meet, only: missing, hash: h });
            }
          }
        }
      }
    }
    stats.depthCompleted = depth;
    frontier = next;
    if (frontier.length === 0) break;
  }
  return finish({ ok: true });
}

/** mulberry32 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomWalks(opts) {
  const start = Date.now();
  const actions = actionByName(opts);
  const rand = prng(opts.seed ?? 1);
  const walks = opts.walks ?? 1000;
  const seen = new Set();
  const stats = { states: 0, transitions: 0, stepsRun: 0, slept: 0, depthCompleted: 0, truncated: false, ms: 0 };
  for (let w = 0; w < walks; w++) {
    const b = build(opts);
    const steps = [];
    for (let d = 1; d <= opts.depth; d++) {
      const candidates = enabledSteps(opts, b);
      if (candidates.length === 0) break;
      const step = candidates[Math.floor(rand() * candidates.length)];
      steps.push(step);
      const out = runStep(opts, actions, b, step, d, true);
      stats.transitions++;
      stats.stepsRun++;
      if (out.violations.length > 0) {
        stats.states = seen.size;
        stats.ms = Date.now() - start;
        return { ok: false, counterexample: { steps, violations: out.violations, provenance: out.provenance }, stats };
      }
      seen.add(hash(stateString(opts, b)));
    }
  }
  stats.states = seen.size;
  stats.depthCompleted = opts.depth;
  stats.ms = Date.now() - start;
  return { ok: true, stats };
}
