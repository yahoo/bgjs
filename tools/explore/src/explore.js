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
//   plain fields, string or symbol keyed) plus the caller's `envKey` is hashed. A state seen
//   before is not expanded again. The hasher cannot see `#private` fields, closures, WeakMaps or
//   anything else not reachable through own enumerable properties: keep such state in a State,
//   or return it from `envKey`.
// - The graphs explored are those setup() runs an action on, builds an extent on, or returns
//   (reachable from the system). An action on any other graph during a step is an error.
// - Properties. A step that throws is a violation, so an invariant can be a behavior that
//   demands what it checks and throws. `checks` run on the starting state and after each step
//   for properties over the whole system (the environment, outputs).
// - Steps are synchronous. A run or side effect that returns a promise, or continues in .then,
//   is an error: explore never runs async continuations. Model replies as actions.
// - Counterexamples are input sequences. `replayExplore` runs one in a fresh system.
// - Reductions from declared dependencies: `cone` hashes only the resources upstream of a
//   property (cone of influence), and `reduction: "sleep"` skips orderings of steps whose
//   footprints are disjoint (partial order reduction with sleep sets). A step that changes a
//   plain extent field or the `envKey` state is dependent on every other step, since reads of
//   those are invisible. With `cone`, the spec's code (runs, side effects, enabled, checks)
//   may read only resources in the cone; a read outside it is an error.
// - Random walks (`mode: "random"`) when the space is too big.
//
// Bounded search is not proof: it is exhaustive testing up to `depth` over the given inputs.
//
// This is a development tool, not part of the library. While it runs it wraps a few methods on
// the library's prototypes (to find the graphs `setup()` builds and to watch reads, writes and
// structure changes) and puts them back when it returns. Pass the `behavior-graph` module your
// code imports as `bg` if it is not the copy this package resolves. Also while it runs,
// `Date.now()`, `new Date()` with no arguments, `Date()` and `Math.random()` throw, and graphs
// that use the default dateProvider get one that returns a fixed time.

import * as defaultBg from 'behavior-graph';

// Captured when this module loads, so the nondeterminism guard does not stop explore's own timing.
const RealDate = Date;
const realNow = Date.now;
const realThen = Promise.prototype.then;

/**
 * @template S
 * @typedef {object} ExploreAction One kind of input, with a small finite domain (like TLC constants).
 * @property {string} name
 * @property {readonly any[]} [inputs] The inputs to try. Omit for an action without one.
 * @property {(sys: S, input: any) => boolean} [enabled] Skip an input in this state. Must be deterministic.
 * @property {(sys: S, input: any) => void} run Deliver the input, normally with one or more graph actions. Synchronous:
 *   returning a promise (other than an actionAsync one) is an error.
 */

/**
 * @typedef {{ action: string, input?: unknown }} ExploreStep One step of an input sequence.
 * @typedef {{ step: ExploreStep | null, depth: number }} CheckContext `depth` is the step's 1-based position;
 *   0 (and `step` null) for the starting state setup() builds.
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
 * @property {() => S} setup Builds a fresh system. Every graph it runs an action on, builds an extent on, or returns
 *   (reachable from the system) is explored. Must be deterministic and synchronous.
 * @property {ExploreAction<S>[]} actions
 * @property {number} depth Maximum number of steps in a sequence.
 * @property {((sys: S, ctx: CheckContext) => string | string[] | void | null | undefined | false)[]} [checks]
 *   Properties checked after every step; return a message (or several) when one fails. A step that throws is also a violation.
 * @property {(sys: S) => unknown} [envKey] State outside the graphs that affects what happens next: pending
 *   requests, armed timers, the clock. Anything a step reads that is not in a graph must be here, or two
 *   different states may be merged and a bug missed.
 * @property {(sys: S, graphs: any[]) => any[]} [cone] Cone of influence: the resources the properties read.
 *   Only these and the resources upstream of them (through declared demands) are hashed, and extents' plain
 *   fields are not. A read of a resource outside the cone by a run, side effect, enabled() or check is an
 *   error. Still unsound if that code reads plain extent fields, or a behavior outside the cone passes a
 *   value to a side effect in a closure.
 * @property {(value: object) => boolean} [opaque] Values not to look inside when hashing extents' plain
 *   fields, such as the environment an extent holds a reference to (its state belongs in `envKey`).
 * @property {'none' | 'sleep'} [reduction] `"sleep"`: partial order reduction. Two steps whose footprints
 *   (resources read and written, including by enabled() and by updates that change nothing, declared
 *   demands of the behaviors that ran, keys passed to `exploreTouch`) are disjoint commute, so only one of
 *   their orders is explored. A step that changes a plain extent field or the `envKey` state, or the
 *   graph's structure, is dependent on every step. Sound for properties of states; a check that reads a
 *   step's outputs may miss the skipped orders.
 * @property {number} [maxStates] Stop after this many distinct states (`stats.truncated`). Default 1,000,000.
 * @property {'bfs' | 'random'} [mode] `"bfs"` (default) or `"random"` walks of length `depth`.
 * @property {number} [walks] Random mode: number of walks. Default 1000.
 * @property {number} [seed] Random mode: seed. Default 1.
 * @property {any} [bg] The `behavior-graph` module the system uses. Default: the one this package resolves.
 */

// ---------------------------------------------------------------------------------------------
// Hooks into the library, installed only while explore runs

/** A mistake in the spec or a limit of the tool. Stops the search instead of counting as a violation. */
export class ExploreError extends Error {
  constructor(message) {
    super('explore: ' + message);
    this.name = 'ExploreError';
  }
}

/** Per graph: its extents in the order added, and the observer for the current step. */
const graphInfo = new WeakMap();
/** The graphs of the system being built, or null outside `build()`. */
let building = null;
let onGraphCreated = null;
/** Graphs of the system being stepped; an action on any other graph during a step is an error. */
let activeGraphs = [];
/** Graphs whose default dateProvider explore replaced, to put back when it returns. */
let swappedDates = [];
/** The library's default date provider (shared by every graph that has not set its own). */
let defaultDateProvider = null;
/** Event timestamps while explore runs: fixed, so a replay sees the same ones. */
const fixedDateProvider = { now: () => new RealDate(0) };

/** Promises returned by actionAsync while explore runs. */
const actionPromises = new WeakSet();

const EVENT_PHASE_UPDATES = 2; // EventLoopPhase.updates in src/graph.ts

function hooksFor(bg) {
  const { Graph, Resource, State, Moment, Extent } = bg;
  const G = Graph.prototype, R = Resource.prototype, St = State.prototype, Mo = Moment.prototype, E = Extent.prototype;
  const saved = {
    actionHelper: G.actionHelper, actionAsyncHelper: G.actionAsyncHelper, sideEffectHelper: G.sideEffectHelper,
    resourceTouched: G.resourceTouched, addExtent: G.addExtent,
    removeExtent: G.removeExtent, updateDemands: G.updateDemands, updateSupplies: G.updateSupplies,
    assertValidAccessor: R.assertValidAccessor, assertValidTraceAccessor: St.assertValidTraceAccessor,
    stateUpdate: St.update, momentUpdate: Mo.update, addResource: E.addResource,
    graphActionAsync: G.actionAsync, extentActionAsync: E.actionAsync,
  };
  for (const [k, v] of Object.entries(saved)) {
    if (typeof v !== 'function') throw new Error(`explore: this behavior-graph has no ${k}; the tool and the library are out of step`);
  }
  defaultDateProvider = new Graph().dateProvider;
  const observer = (g) => graphInfo.get(g)?.observer ?? null;

  /** True when the action should be dispatched again (the graph was just registered). */
  const admit = (g) => {
    if (building !== null) {
      if (!graphInfo.has(g)) { register(g); return true; }
      if (!building.includes(g)) {
        throw new ExploreError('setup() ran an action on a graph from an earlier system. setup() must build a fresh Graph ' +
          'each time it is called; a graph kept in a module variable or shared fake is reused between systems.');
      }
      return false;
    }
    if (!activeGraphs.includes(g)) {
      throw new ExploreError(graphInfo.has(g)
        ? 'an action ran on a graph outside a step (in enabled(), a check, envKey or cone), or on a graph of another system. Only actions\' run may start actions.'
        : 'a step ran an action on a graph that setup() did not build, or that explore did not see it build. explore ' +
          'hashes only the graphs setup() creates: create every Graph in setup(), and keep it reachable from the system ' +
          'setup() returns (or run an action on it there).');
    }
    return false;
  };
  G.actionHelper = function (...args) {
    // dispatch again so that anything onGraphCreated installed on the instance sees this action
    if (admit(this)) return this.actionHelper(...args);
    return saved.actionHelper.apply(this, args);
  };
  G.actionAsyncHelper = function (...args) {
    if (admit(this)) return this.actionAsyncHelper(...args);
    return saved.actionAsyncHelper.apply(this, args);
  };
  // a run may return the promise of an action it started (`run: (s) => s.graph.actionAsync(...)`):
  // the action itself ran synchronously
  G.actionAsync = function (...args) {
    const p = saved.graphActionAsync.apply(this, args);
    actionPromises.add(p);
    return p;
  };
  E.actionAsync = function (...args) {
    const p = saved.extentActionAsync.apply(this, args);
    actionPromises.add(p);
    return p;
  };
  G.sideEffectHelper = function (effect) {
    const block = effect.block;
    if (typeof block === 'function') {
      effect.block = function (...a) {
        const r = block.apply(this, a);
        if (isThenable(r) && !actionPromises.has(r)) {
          throw new ExploreError(`a side effect${effect.debugName ? ` (${effect.debugName})` : ''} returned a promise. ` + asyncAdvice);
        }
        return r;
      };
    }
    return saved.sideEffectHelper.call(this, effect);
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
  // update() returns early when the value is unchanged, before resourceTouched; it still
  // depends on the current value, so it reads (and conservatively writes) the resource
  St.update = function (...args) {
    const o = observer(this.graph);
    if (o) { o.read(this, true); o.write(this, true); }
    return saved.stateUpdate.apply(this, args);
  };
  Mo.update = function (...args) {
    const o = observer(this.graph);
    if (o) { o.read(this, true); o.write(this, true); }
    return saved.momentUpdate.apply(this, args);
  };
  // every extent's constructor creates its addedToGraph state, so this sees each graph setup() builds extents on
  E.addResource = function (resource) {
    if (building !== null && this.graph instanceof Graph && !graphInfo.has(this.graph)) register(this.graph);
    return saved.addResource.call(this, resource);
  };

  return () => {
    Object.assign(G, { actionHelper: saved.actionHelper, actionAsyncHelper: saved.actionAsyncHelper, sideEffectHelper: saved.sideEffectHelper,
      resourceTouched: saved.resourceTouched, addExtent: saved.addExtent,
      removeExtent: saved.removeExtent, updateDemands: saved.updateDemands, updateSupplies: saved.updateSupplies });
    R.assertValidAccessor = saved.assertValidAccessor;
    St.assertValidTraceAccessor = saved.assertValidTraceAccessor;
    St.update = saved.stateUpdate;
    Mo.update = saved.momentUpdate;
    E.addResource = saved.addResource;
    G.actionAsync = saved.graphActionAsync;
    E.actionAsync = saved.extentActionAsync;
  };
}

function register(graph) {
  const info = { extents: new Set(), observer: null };
  graphInfo.set(graph, info);
  building.push(graph);
  if (graph.dateProvider === defaultDateProvider) {
    graph.dateProvider = fixedDateProvider;
    swappedDates.push(graph);
  }
  // the event loop sets lastEvent as each event completes; one completing after explore
  // returned came from an async continuation explore never ran
  let last = graph.lastEvent;
  Object.defineProperty(graph, 'lastEvent', {
    configurable: true,
    enumerable: true,
    get: () => last,
    set: (e) => { last = e; if (hookDepth === 0) lateEvents++; },
  });
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

let lateEvents = 0;
/**
 * The number of events that completed on graphs explore built after explore (or
 * replayExplore) returned, since the last call; resets the count. Wait a macrotask after
 * `explore()` (`await new Promise((r) => setTimeout(r, 0))`) and call it: a nonzero count means
 * a side effect or run continued asynchronously (after an await, or in a timer), work explore
 * never ran, so a "no violation" result does not cover it. The CLI does this. Graphs you keep
 * using after `replayExplore` count too.
 */
export function exploreLateEvents() {
  const n = lateEvents;
  lateEvents = 0;
  return n;
}

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
  const swapped = swappedDates;
  swappedDates = [];
  try {
    return fn();
  } finally {
    hookDepth--; activeBg = null;
    for (const g of swappedDates) if (g.dateProvider === fixedDateProvider) g.dateProvider = defaultDateProvider;
    swappedDates = swapped;
    unguard(); unhook();
  }
}

// ---------------------------------------------------------------------------------------------
// Finding the system's graphs, and objects from another copy of the library

const ownKeys = (o) => [...Object.keys(o), ...symbolsOf(o)];
const symbolsOf = (o) => Object.getOwnPropertySymbols(o).filter((s) => Object.prototype.propertyIsEnumerable.call(o, s));
const isThenable = (v) => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';

const asyncAdvice = 'explore runs each step synchronously and never runs async continuations (promises, timers), so work ' +
  'after an await or in a .then is not explored. Model the reply as an explicit action that delivers it, as examples/search.mjs does.';

function checkForeign(bg, o) {
  if (o instanceof bg.Graph || o instanceof bg.Extent) return;
  let what = null;
  if ('activatedBehaviors' in o && 'eventLoopState' in o && 'dateProvider' in o) what = 'Graph';
  else if (Array.isArray(o.resources) && Array.isArray(o.behaviors) && 'addedToGraph' in o && 'graph' in o) what = 'Extent';
  if (what !== null) {
    throw new ExploreError(`the system holds a ${what} (${o.constructor?.name ?? 'object'}) that is not an instance of the ` +
      'behavior-graph module explore uses: another copy of behavior-graph is loaded (an ESM and a CJS build, or two ' +
      'node_modules). Import one copy everywhere and pass that module to explore as `bg`.');
  }
}

/**
 * Registers every graph reachable from `sys`, directly or through an extent's graph, so a graph
 * that setup() builds but does not act on is still hashed. Throws on another library copy.
 */
function discoverGraphs(bg, sys) {
  const { Graph, Extent, Resource, Behavior } = bg;
  const seen = new Set();
  const queue = [sys];
  const visit = (g) => {
    if (!graphInfo.has(g)) register(g);
    else if (!building.includes(g)) {
      throw new ExploreError('setup() returned a system holding a graph from an earlier system. setup() must build a fresh Graph each time it is called.');
    }
  };
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    if (v === null || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (v instanceof Graph) { visit(v); continue; }
    if (v instanceof Resource || v instanceof Behavior || v instanceof RealDate || ArrayBuffer.isView(v) || isThenable(v)) continue;
    if (v instanceof Extent) {
      if (v.graph instanceof Graph) visit(v.graph);
      for (const k of ownKeys(v)) if (!extentBaseFields.has(k)) queue.push(v[k]);
      continue;
    }
    checkForeign(bg, v);
    if (v instanceof Map) { for (const [k, x] of v) queue.push(k, x); continue; }
    if (v instanceof Set) { for (const x of v) queue.push(x); continue; }
    for (const k of ownKeys(v)) queue.push(v[k]);
  }
}

// ---------------------------------------------------------------------------------------------
// Environment footprints

let currentFootprint = null;

/**
 * Records that the current step reads or writes something outside the graph, for
 * `reduction: "sleep"`. No longer needed for state that `envKey` returns or extents hold in
 * plain fields: a step that changes either is treated as dependent on every other step. Does
 * nothing outside `explore()`.
 * @param {string} key
 * @param {'read' | 'write' | 'readwrite'} mode
 */
export function exploreTouch(key, mode) {
  if (currentFootprint === null) return;
  if (mode !== 'write') currentFootprint.reads.add('env:' + key);
  if (mode !== 'read') currentFootprint.writes.add('env:' + key);
}

function independent(a, b) {
  // reads of plain fields and of the environment are invisible, so a step that changed either
  // may affect any other step
  if (a.structure || b.structure || a.untracked || b.untracked) return false;
  for (const w of a.writes) if (b.writes.has(w) || b.reads.has(w)) return false;
  for (const w of b.writes) if (a.reads.has(w)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Running steps

/** >0 while the spec's own code runs (setup, run); promise continuations started there are an error. */
let userCode = 0;
function asUserCode(fn) {
  userCode++;
  try { return fn(); } finally { userCode--; }
}

function build(opts) {
  const previous = building;
  building = [];
  const graphs = building;
  try {
    const sys = asUserCode(() => opts.setup());
    if (isThenable(sys)) throw new ExploreError('setup() returned a promise. ' + asyncAdvice);
    discoverGraphs(opts.bg ?? defaultBg, sys);
    if (graphs.length === 0) {
      throw new Error("explore: setup() ran no action on any graph and returned no graph or extent. Add the system's extents with an action " +
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

/** A read by the spec's code (an action block, a side effect, enabled(), a check), not by a behavior or the library. */
function isUserRead(r) {
  const g = r.graph;
  return g.currentBehavior == null && g.eventLoopState?.phase !== EVENT_PHASE_UPDATES;
}

/**
 * With `cone`, the spec's code may read only resources in the cone: states that differ outside
 * it are merged, so a read there could see either. Behaviors are exempt (what a cone resource's
 * supplier demands is in the cone; other behaviors write only outside it).
 */
function coneGuard(opts, b) {
  if (!opts.cone) return null;
  const before = coneOf(opts.cone(b.sys, b.graphs));
  const reads = new Map();
  return {
    note(r, where) {
      if (!before.has(r) && !reads.has(r) && isUserRead(r)) reads.set(r, where);
    },
    verify() {
      if (reads.size === 0) return;
      const after = coneOf(opts.cone(b.sys, b.graphs));
      for (const [r, where] of reads) {
        if (after.has(r)) continue;
        const name = describeResource(r);
        throw new ExploreError(`${where} read ${name}, which is outside the cone. cone hashes only the resources it returns and ` +
          `what they demand, so states that differ in ${name} are merged and this read could see either. Add ${name} to what ` +
          'cone returns (or the resource that feeds it), or drop the cone option.');
      }
    },
  };
}

const noObserver = { read() {}, write() {}, behaviorRan() {}, structureChanged() {} };

function setObservers(b, observer) {
  for (const g of b.graphs) graphInfo.get(g).observer = observer;
}

function runChecks(opts, b, ctx, cone) {
  const violations = [];
  if (!opts.checks?.length) return violations;
  setObservers(b, cone ? { ...noObserver, read: (r) => cone.note(r, 'a check') } : null);
  try {
    for (const check of opts.checks) {
      try {
        const r = check(b.sys, ctx);
        if (typeof r === 'string') violations.push(r);
        else if (Array.isArray(r)) violations.push(...r);
      } catch (e) {
        if (e instanceof ExploreError) throw e;
        violations.push(`check threw: ${errString(e)}`);
      }
    }
  } finally {
    setObservers(b, null);
  }
  return violations;
}

/** The checks on the state setup() built: a violation there is a counterexample with no steps. */
function checkStart(opts, b) {
  const cone = coneGuard(opts, b);
  const violations = runChecks(opts, b, { step: null, depth: 0 }, cone);
  cone?.verify();
  return violations;
}

/** Plain extent fields and the environment: state the footprint cannot see reads of. */
function untrackedString(opts, b) {
  const canon = new Canon(opts.bg ?? defaultBg, b.graphs, opts.opaque);
  const parts = [];
  for (const g of b.graphs) {
    for (const ext of extentsOf(g)) parts.push(canon.fields(ext).join('|'));
    parts.push('/');
  }
  if (opts.envKey) parts.push(canon.value(opts.envKey(b.sys)));
  return parts.join('\n');
}

/**
 * Runs one step in `b` and checks it, recording what it touched. `enabledReads` are the
 * resource keys its `enabled()` read, charged to its footprint. With `untrackedBefore`
 * (`untrackedString` of the state before the step), a change to plain fields or the
 * environment marks the footprint `untracked`.
 */
function runStep(opts, actions, b, step, depth, record, enabledReads, untrackedBefore) {
  const footprint = { reads: new Set(enabledReads ?? []), writes: new Set(), structure: false, untracked: false };
  const provenance = { updated: [], behaviors: [] };
  const keys = record ? resourceKeys(b.graphs) : null;
  const keyOf = (r) => keys.get(r) ?? 'new:' + (r.debugName ?? '?');
  const cone = record ? coneGuard(opts, b) : null;
  const where = `action "${stepKey(step)}"`;
  const observer = record ? {
    // `update`: the read is a State or Moment update's comparison, which influences only that resource
    read: (r, update) => { footprint.reads.add(keyOf(r)); if (!update) cone?.note(r, where); },
    // `quiet`: a State or Moment update, which may not change anything
    write: (r, quiet) => { footprint.writes.add(keyOf(r)); if (!quiet) provenance.updated.push(describeResource(r)); },
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
  setObservers(b, observer);
  activeGraphs = b.graphs;
  const previousFootprint = currentFootprint;
  currentFootprint = record ? footprint : null;
  try {
    const r = asUserCode(() => action.run(b.sys, step.input));
    if (isThenable(r) && !actionPromises.has(r)) throw new ExploreError(`the run of action "${step.action}" returned a promise. ` + asyncAdvice);
  } catch (e) {
    if (e instanceof ExploreError) throw e;
    violations.push(`threw: ${errString(e)}`);
  } finally {
    currentFootprint = previousFootprint;
    activeGraphs = [];
    setObservers(b, null);
  }
  if (violations.length === 0 && record) {
    violations.push(...runChecks(opts, b, { step, depth }, cone));
    cone?.verify();
    if (untrackedBefore !== undefined && untrackedString(opts, b) !== untrackedBefore) footprint.untracked = true;
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

/**
 * The steps enabled in `b`, and for each the resource keys its `enabled()` read: a step that
 * writes one of them can disable it, so the two do not commute.
 */
function enabledSteps(opts, b) {
  const steps = [];
  const reads = new Map();
  let keys = null;
  const cone = coneGuard(opts, b);
  let current = null, where = '';
  setObservers(b, { ...noObserver, read: (r) => {
    keys ??= resourceKeys(b.graphs);
    current?.add(keys.get(r) ?? 'new:' + (r.debugName ?? '?'));
    cone?.note(r, where);
  } });
  const enabled = (a, step) => {
    if (a.enabled === undefined) return true;
    current = new Set();
    where = `enabled() of action "${stepKey(step)}"`;
    try {
      const ok = a.enabled(b.sys, step.input);
      reads.set(stepKey(step), current);
      return ok;
    } finally {
      current = null;
    }
  };
  try {
    for (const a of opts.actions) {
      if (a.inputs === undefined) {
        const step = { action: a.name };
        if (enabled(a, step)) steps.push(step);
      } else {
        for (const input of a.inputs) {
          const step = { action: a.name, input };
          if (enabled(a, step)) steps.push(step);
        }
      }
    }
  } finally {
    setObservers(b, null);
  }
  cone?.verify();
  return { steps, reads };
}

/** A step as one line: `name` or `name <input as JSON>`. */
export function stepKey(s) {
  return s.input === undefined ? s.action : s.action + ' ' + JSON.stringify(s.input);
}

/**
 * Replays `steps` in a fresh system and returns it, with the violations of the first step that
 * had any (`failedAt` 0: the checks failed on the state setup() built). Use it to turn a
 * counterexample into a debugging session. `onGraph` is called with each graph `setup()` uses,
 * before its first action runs (to attach a tracer, for example).
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
    const atStart = checkStart(opts, b);
    if (atStart.length > 0) return { sys: b.sys, violations: atStart, failedAt: 0 };
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
    this.graphs = new Set(graphs);
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
      if (id !== undefined) return `@E${id}`;
      if (!this.graphs.has(o.graph)) {
        throw new ExploreError(`the state holds an extent (${o.constructor.name}) whose graph explore does not track, so its ` +
          'state would be ignored. Build its graph in setup() and keep it reachable from the system setup() returns.');
      }
      // in a tracked graph but not in it (not added yet, or removed): its state is part of this one
      if (this.seen.has(o)) return '@cycle';
      this.seen.add(o);
      try {
        return `@U{${this.extent(o, null)}}`;
      } finally {
        this.seen.delete(o);
      }
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
      if (o instanceof RealDate) return 'D' + o.getTime();
      checkForeign(this.bg, o);
      const fields = Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + this.value(o[k]));
      for (const s of symbolsOf(o)) fields.push('[' + String(s) + ']:' + this.value(o[s]));
      return (o.constructor?.name ?? '') + '{' + fields.join(',') + '}';
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

  /** An extent's plain fields (not resources or functions), string and symbol keyed. */
  fields(ext) {
    const parts = [];
    const resources = new Set(ext.resources);
    const add = (label, field) => {
      if (resources.has(field) || typeof field === 'function') return;
      parts.push(`${label}:${this.value(field)}`);
    };
    for (const k of Object.keys(ext).sort()) if (!extentBaseFields.has(k)) add(k, ext[k]);
    for (const s of symbolsOf(ext)) add(`[${String(s)}]`, ext[s]);
    return parts;
  }

  extent(ext, only) {
    const parts = [ext.constructor.name];
    ext.resources.forEach((r, ri) => {
      if (only === null || only.has(r)) parts.push(`${ri}=${this.stateOf(r)}`);
    });
    if (only === null) parts.push(...this.fields(ext));
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

function validateOptions(opts) {
  const fail = (m) => { throw new ExploreError(m); };
  if (opts === null || typeof opts !== 'object') fail('explore needs options: { setup, actions, depth, checks? }');
  if (typeof opts.setup !== 'function') fail('setup must be a function that builds a fresh system');
  if (!Array.isArray(opts.actions)) fail('actions must be an array of { name, inputs?, enabled?, run }');
  const int = (k, min, required) => {
    const v = opts[k];
    if (v === undefined && !required) return;
    if (!Number.isInteger(v) || v < min) fail(`${k} must be an integer >= ${min}, not ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`);
  };
  int('depth', 0, true);
  int('maxStates', 1, false);
  int('walks', 1, false);
  if (opts.seed !== undefined && !Number.isInteger(opts.seed)) fail(`seed must be an integer, not ${String(opts.seed)}`);
  if (opts.mode !== undefined && opts.mode !== 'bfs' && opts.mode !== 'random') fail(`mode must be "bfs" or "random", not ${JSON.stringify(opts.mode)}`);
  if (opts.reduction !== undefined && opts.reduction !== 'none' && opts.reduction !== 'sleep') {
    fail(`reduction must be "none" or "sleep", not ${JSON.stringify(opts.reduction)}`);
  }
}

/**
 * Explores every input sequence up to `opts.depth`. See the comment at the top of this file.
 * @template S
 * @param {ExploreOptions<S>} opts
 * @returns {ExploreResult}
 */
export function explore(opts) {
  validateOptions(opts);
  return withHooks(opts.bg ?? defaultBg, () => ((opts.mode ?? 'bfs') === 'random' ? randomWalks(opts) : bfs(opts)));
}


/**
 * While explore runs, `Date.now()`, `new Date()`, `Date()` and `Math.random()` throw: their
 * results would differ on replay and the search would silently merge or miss states. Events'
 * timestamps come from a fixed `dateProvider` unless the system set its own. Promise
 * continuations started by setup() or a step throw too: explore never runs them.
 */
function guardNondeterminism() {
  const saved = { Date: globalThis.Date, now: RealDate.now, random: Math.random, then: Promise.prototype.then };
  const clock = 'inject a fixed graph.dateProvider, or a clock object that setup() creates, and read time from it';
  RealDate.now = function now() {
    throw new Error(`explore: Date.now() is not replayable: ${clock}`);
  };
  const guarded = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) throw new Error(`explore: new Date() with no arguments is not replayable: ${clock}`);
      return Reflect.construct(target, args, newTarget === guarded ? target : newTarget);
    },
    apply() {
      throw new Error(`explore: Date() is not replayable: ${clock}`);
    },
  });
  globalThis.Date = guarded;
  Math.random = function random() {
    throw new Error('explore: Math.random() is not replayable; pass randomness in as an action input');
  };
  Promise.prototype.then = function then(...args) {
    if (userCode > 0) throw new ExploreError('a step or setup() continued in a promise (.then, .catch, .finally): async work. ' + asyncAdvice);
    return realThen.apply(this, args);
  };
  return () => {
    globalThis.Date = saved.Date;
    RealDate.now = saved.now;
    Math.random = saved.random;
    Promise.prototype.then = saved.then;
  };
}

const startViolation = (violations) => ({ ok: false, counterexample: { steps: [], violations, provenance: { updated: [], behaviors: [] } } });

function bfs(opts) {
  const start = realNow();
  const actions = actionByName(opts);
  const maxStates = opts.maxStates ?? 1_000_000;
  const sleepOn = opts.reduction === 'sleep';
  const stats = { states: 0, transitions: 0, stepsRun: 0, slept: 0, depthCompleted: 0, truncated: false, ms: 0 };
  const finish = (r) => {
    stats.ms = realNow() - start;
    return { ...r, stats };
  };

  const root = build(opts);
  const visited = new Map();
  const rootHash = hash(stateString(opts, root));
  visited.set(rootHash, sleepOn ? new Set() : null);
  stats.states = 1;
  const atStart = checkStart(opts, root);
  if (atStart.length > 0) return finish(startViolation(atStart));
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
      const { steps: candidates, reads: enabledReads } = enabledSteps(opts, here);
      // every sibling starts from this state
      const untrackedHere = sleepOn ? untrackedString(opts, here) : undefined;
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
        const out = runStep(opts, actions, b, step, depth, true, enabledReads.get(key), untrackedHere);
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
  const start = realNow();
  const actions = actionByName(opts);
  const rand = prng(opts.seed ?? 1);
  const walks = opts.walks ?? 1000;
  const seen = new Set();
  const stats = { states: 0, transitions: 0, stepsRun: 0, slept: 0, depthCompleted: 0, truncated: false, ms: 0 };
  const atStart = checkStart(opts, build(opts));
  if (atStart.length > 0) return { ...startViolation(atStart), stats: { ...stats, ms: realNow() - start } };
  for (let w = 0; w < walks; w++) {
    const b = build(opts);
    const steps = [];
    for (let d = 1; d <= opts.depth; d++) {
      const { steps: candidates, reads: enabledReads } = enabledSteps(opts, b);
      if (candidates.length === 0) break;
      const step = candidates[Math.floor(rand() * candidates.length)];
      steps.push(step);
      const out = runStep(opts, actions, b, step, d, true, enabledReads.get(stepKey(step)));
      stats.transitions++;
      stats.stepsRun++;
      if (out.violations.length > 0) {
        stats.states = seen.size;
        stats.ms = realNow() - start;
        return { ok: false, counterexample: { steps, violations: out.violations, provenance: out.provenance }, stats };
      }
      seen.add(hash(stateString(opts, b)));
    }
  }
  stats.states = seen.size;
  stats.depthCompleted = opts.depth;
  stats.ms = realNow() - start;
  return { ok: true, stats };
}
