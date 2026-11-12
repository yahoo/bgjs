//
//  Copyright Yahoo 2026
//

/**
 * A bounded model checker for behavior graphs (spike).
 *
 * `explore()` runs the real graph over every sequence of inputs up to a depth, breadth first,
 * and checks properties after each step. A graph's events are deterministic, so the only
 * nondeterminism is the order and choice of inputs, and the checker needs no model: it runs
 * your code.
 *
 * - **Stateless replay.** There is no snapshot or restore. Each branch builds a fresh system with
 *   `setup()` and replays its input prefix, as CHESS and VeriSoft do.
 * - **Visited-state hashing.** After each step the state of every live extent (State values and
 *   plain fields) plus the caller's `envKey` is hashed. A state seen before is not expanded again.
 * - **Properties.** A step that throws is a violation, so an invariant can be a behavior that
 *   demands what it checks and throws. `checks` run after each step for properties over the
 *   whole system (the environment, outputs).
 * - **Counterexamples** are input sequences. {@link replayExplore} runs one in a fresh system.
 * - **Reductions** from declared dependencies: `cone` hashes only the resources upstream of a
 *   property (cone of influence), and `reduction: "sleep"` skips orderings of steps whose
 *   footprints are disjoint (partial order reduction with sleep sets).
 * - **Random walks** (`mode: "random"`) when the space is too big.
 *
 * Bounded search is not proof: it is exhaustive testing up to `depth` over the given inputs.
 */

import {Graph} from "./graph.js";
import {Extent} from "./extent.js";
import {Moment, Resource, State} from "./resource.js";
import {Behavior} from "./behavior.js";
import {GraphObserver} from "./common.js";

/** One kind of input, with a small finite domain (like TLC constants). */
export interface ExploreAction<S, I = any> {
    name: string;
    /** The inputs to try. Omit for an action without one. */
    inputs?: readonly I[];
    /** Skip an input in this state (fewer branches). Must be deterministic. */
    enabled?: (sys: S, input: I) => boolean;
    /** Deliver the input, normally with one or more graph actions. */
    run: (sys: S, input: I) => void;
}

/** One step of an input sequence. JSON-serialisable if the inputs are. */
export interface ExploreStep {
    action: string;
    input?: unknown;
}

export interface CheckContext {
    /** The step just taken. */
    step: ExploreStep;
    /** Its 1-based position in the sequence. */
    depth: number;
}

/** Returns nothing when the property holds, or one or more violation messages. */
export type ExploreCheck<S> = (sys: S, ctx: CheckContext) => string | string[] | void | null | undefined | false;

export interface ExploreOptions<S> {
    /** Builds a fresh system. Every graph created inside it is explored. Must be deterministic. */
    setup: () => S;
    actions: ExploreAction<S>[];
    /** Maximum number of steps in a sequence. */
    depth: number;
    /** Properties checked after every step. A step that throws is also a violation. */
    checks?: ExploreCheck<S>[];
    /**
     * State outside the graphs that affects what happens next: pending requests, armed timers,
     * the clock. Anything a step reads that is not in a graph must be here, or two different
     * states may be merged and a bug missed.
     */
    envKey?: (sys: S) => unknown;
    /**
     * Cone of influence: the resources the properties read. Only these and the resources
     * upstream of them (through declared demands) are hashed, and extents' plain fields are not.
     * Sound only if the checks read nothing else and every side effect that feeds back into the
     * graph depends only on the cone (or on `envKey`).
     */
    cone?: (sys: S, graphs: Graph[]) => Resource[];
    /**
     * Values not to look inside when hashing extents' plain fields, such as the environment an
     * extent holds a reference to (its state belongs in `envKey`).
     */
    opaque?: (value: object) => boolean;
    /**
     * `"sleep"`: partial order reduction. Two steps whose footprints (resources read and
     * written, declared demands of the behaviors that ran, keys passed to {@link exploreTouch})
     * are disjoint commute, so only one of their orders is explored. Sound for properties of
     * states; a check that reads a step's outputs may miss the skipped orders.
     */
    reduction?: "none" | "sleep";
    /** Stop after this many distinct states (the result says `truncated`). Default 1,000,000. */
    maxStates?: number;
    /** `"bfs"` (default) or `"random"` walks of length `depth`. */
    mode?: "bfs" | "random";
    /** Random mode: number of walks. Default 1000. */
    walks?: number;
    /** Random mode: seed. Default 1. */
    seed?: number;
}

export interface Provenance {
    /** Resources the failing step updated, as `Extent.resource`. */
    updated: string[];
    /** Behaviors that ran in the failing step, by the resources they supply. */
    behaviors: string[];
}

export interface Counterexample {
    steps: ExploreStep[];
    violations: string[];
    provenance: Provenance;
}

export interface ExploreStats {
    /** Distinct states seen (after hashing). */
    states: number;
    /** Steps taken from an explored state (each costs one replay). */
    transitions: number;
    /** Steps run in total, including replayed prefixes. */
    stepsRun: number;
    /** Steps skipped by sleep sets. */
    slept: number;
    /** Deepest level fully explored. */
    depthCompleted: number;
    truncated: boolean;
    ms: number;
}

export interface ExploreResult {
    ok: boolean;
    counterexample?: Counterexample;
    stats: ExploreStats;
}

// ---------------------------------------------------------------------------------------------
// Environment footprints

interface Footprint {
    reads: Set<string>;
    writes: Set<string>;
    structure: boolean;
}

let currentFootprint: Footprint | null = null;

/**
 * Records that the current step reads or writes something outside the graph (a service queue,
 * the clock), for `reduction: "sleep"`. Does nothing outside `explore()`. Call it from the
 * environment code your actions and side effects use.
 */
export function exploreTouch(key: string, mode: "read" | "write" | "readwrite") {
    if (currentFootprint === null) return;
    if (mode !== "write") currentFootprint.reads.add("env:" + key);
    if (mode !== "read") currentFootprint.writes.add("env:" + key);
}

function independent(a: Footprint, b: Footprint): boolean {
    if (a.structure || b.structure) return false;
    for (const w of a.writes) if (b.writes.has(w) || b.reads.has(w)) return false;
    for (const w of b.writes) if (a.reads.has(w)) return false;
    return true;
}

// ---------------------------------------------------------------------------------------------
// Running steps

interface Built<S> {
    sys: S;
    graphs: Graph[];
}

function build<S>(setup: () => S): Built<S> {
    const graphs: Graph[] = [];
    const previous = Graph._onCreate;
    Graph._onCreate = (g) => graphs.push(g);
    try {
        return {sys: setup(), graphs};
    } finally {
        Graph._onCreate = previous;
    }
}

function actionByName<S>(opts: ExploreOptions<S>): Map<string, ExploreAction<S>> {
    const m = new Map<string, ExploreAction<S>>();
    for (const a of opts.actions) {
        if (m.has(a.name)) throw new Error(`explore: two actions named ${a.name}`);
        m.set(a.name, a);
    }
    return m;
}

function errString(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** Canonical names for resources (`<graph>.<extent>.<resource>`), stable for one state. */
function resourceKeys(graphs: Graph[]): Map<Resource, string> {
    const keys = new Map<Resource, string>();
    graphs.forEach((g, gi) => {
        let ei = 0;
        for (const ext of g.extents) {
            ext.resources.forEach((r, ri) => keys.set(r, `${gi}.${ei}.${ri}`));
            ei++;
        }
    });
    return keys;
}

interface StepOutcome {
    violations: string[];
    footprint: Footprint;
    provenance: Provenance;
}

/** Runs one step in `b` and checks it, recording what it touched. */
function runStep<S>(opts: ExploreOptions<S>, actions: Map<string, ExploreAction<S>>, b: Built<S>, step: ExploreStep, depth: number, record: boolean): StepOutcome {
    const footprint: Footprint = {reads: new Set(), writes: new Set(), structure: false};
    const provenance: Provenance = {updated: [], behaviors: []};
    const keys = record ? resourceKeys(b.graphs) : null;
    const keyOf = (r: Resource): string => keys!.get(r) ?? "new:" + (r.debugName ?? "?");
    const observer: GraphObserver | null = record ? {
        read: (r: Resource) => { footprint.reads.add(keyOf(r)); },
        write: (r: Resource) => {
            footprint.writes.add(keyOf(r));
            provenance.updated.push(describeResource(r));
        },
        behaviorRan: (bh: Behavior) => {
            bh.demands?.forEach((d) => footprint.reads.add(keyOf(d)));
            bh.traceDemands?.forEach((d) => footprint.reads.add(keyOf(d)));
            provenance.behaviors.push(describeBehavior(bh));
        },
        structureChanged: () => { footprint.structure = true; },
    } : null;
    const violations: string[] = [];
    const action = actions.get(step.action);
    if (action === undefined) throw new Error(`explore: no action named ${step.action}`);
    for (const g of b.graphs) g._observer = observer;
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
        for (const g of b.graphs) g._observer = null;
    }
    if (violations.length === 0 && record) {
        for (const check of opts.checks ?? []) {
            try {
                const r = check(b.sys, {step, depth});
                if (typeof r === "string") violations.push(r);
                else if (Array.isArray(r)) violations.push(...r);
            } catch (e) {
                violations.push(`check threw: ${errString(e)}`);
            }
        }
    }
    return {violations, footprint, provenance};
}

function describeResource(r: Resource): string {
    const ext = r.extent?.debugName ?? r.extent?.constructor?.name ?? "?";
    return `${ext}.${r.debugName ?? "?"}`;
}

function describeBehavior(b: Behavior): string {
    const ext = b.extent?.debugName ?? b.extent?.constructor?.name ?? "?";
    const supplies = b.supplies ? [...b.supplies].map((r) => r.debugName ?? "?") : [];
    return supplies.length > 0 ? `${ext}: supplies ${supplies.join(", ")}` : `${ext}: (no supplies)`;
}

function replayPrefix<S>(opts: ExploreOptions<S>, actions: Map<string, ExploreAction<S>>, prefix: ExploreStep[]): Built<S> {
    const b = build(opts.setup);
    for (let i = 0; i < prefix.length; i++) {
        const out = runStep(opts, actions, b, prefix[i], i + 1, false);
        if (out.violations.length > 0) {
            throw new Error(`explore: replay of a passing prefix failed at step ${i + 1} (${out.violations[0]}); is setup() deterministic?`);
        }
    }
    return b;
}

function enabledSteps<S>(opts: ExploreOptions<S>, b: Built<S>): ExploreStep[] {
    const steps: ExploreStep[] = [];
    for (const a of opts.actions) {
        if (a.inputs === undefined) {
            if (a.enabled === undefined || a.enabled(b.sys, undefined)) steps.push({action: a.name});
        } else {
            for (const input of a.inputs) {
                if (a.enabled === undefined || a.enabled(b.sys, input)) steps.push({action: a.name, input});
            }
        }
    }
    return steps;
}

function stepKey(s: ExploreStep): string {
    return s.input === undefined ? s.action : s.action + " " + JSON.stringify(s.input);
}

/**
 * Replays `steps` in a fresh system and returns it, with the violations of the last step that
 * had any. Use it to turn a counterexample into a debugging session.
 */
export function replayExplore<S>(opts: ExploreOptions<S>, steps: ExploreStep[]): {sys: S; violations: string[]; failedAt?: number} {
    const actions = actionByName(opts);
    const b = build(opts.setup);
    for (let i = 0; i < steps.length; i++) {
        const out = runStep(opts, actions, b, steps[i], i + 1, true);
        if (out.violations.length > 0) return {sys: b.sys, violations: out.violations, failedAt: i + 1};
    }
    return {sys: b.sys, violations: []};
}

// ---------------------------------------------------------------------------------------------
// State hashing

/** Fields every Extent has; not part of its state. */
const extentBaseFields = new Set(["debugConstructorName", "debugName", "behaviors", "resources", "graph", "addedToGraphWhen", "removedFromGraphWhen", "lifetime", "unsubscribes", "addedToGraph"]);

class Canon {
    private extentIds = new Map<Extent, number>();
    private resourceIds = new Map<Resource, string>();
    private seen = new Set<object>();
    constructor(graphs: Graph[], private opaque?: (value: object) => boolean) {
        let ei = 0;
        for (const g of graphs) {
            for (const ext of g.extents) {
                this.extentIds.set(ext, ei);
                ext.resources.forEach((r, ri) => this.resourceIds.set(r, `${ei}.${ri}`));
                ei++;
            }
        }
    }

    value(v: unknown): string {
        switch (typeof v) {
            case "undefined": return "u";
            case "number": return "n" + String(v);
            case "string": return JSON.stringify(v);
            case "boolean": return v ? "T" : "F";
            case "bigint": return "b" + String(v);
            case "symbol": return "y" + String(v);
            case "function": return "f";
        }
        if (v === null) return "N";
        const o = v as object;
        if (o instanceof Extent) {
            const id = this.extentIds.get(o);
            return id === undefined ? `@X${o.constructor.name}` : `@E${id}`;
        }
        if (o instanceof Resource) return `@R${this.resourceIds.get(o) ?? "?"}`;
        if (o instanceof Behavior || o instanceof Graph) return "@B";
        if (this.opaque?.(o)) return "@opaque";
        if (this.seen.has(o)) return "@cycle";
        this.seen.add(o);
        try {
            if (Array.isArray(o)) return "[" + o.map((x) => this.value(x)).join(",") + "]";
            if (o instanceof Map) return "M{" + [...o].map(([k, x]) => this.value(k) + ":" + this.value(x)).join(",") + "}";
            if (o instanceof Set) return "S{" + [...o].map((x) => this.value(x)).join(",") + "}";
            if (o instanceof Date) return "D" + o.getTime();
            const keys = Object.keys(o).sort();
            return (o.constructor?.name ?? "") + "{" + keys.map((k) => JSON.stringify(k) + ":" + this.value((o as any)[k])).join(",") + "}";
        } finally {
            this.seen.delete(o);
        }
    }

    stateOf(r: Resource): string {
        if (r instanceof State) return this.value((r as any).currentState.value);
        // Moments reset at the end of every event; between steps they hold nothing.
        if (r instanceof Moment) return "m";
        return "r";
    }

    extent(ext: Extent, only: Set<Resource> | null): string {
        const parts: string[] = [ext.constructor.name];
        ext.resources.forEach((r, ri) => {
            if (only === null || only.has(r)) parts.push(`${ri}=${this.stateOf(r)}`);
        });
        if (only === null) {
            const resources = new Set<unknown>(ext.resources);
            for (const k of Object.keys(ext).sort()) {
                if (extentBaseFields.has(k)) continue;
                const field = (ext as any)[k];
                if (resources.has(field) || typeof field === "function") continue;
                parts.push(`${k}:${this.value(field)}`);
            }
        }
        return parts.join("|");
    }
}

/** The resources upstream of `roots`: their suppliers' demands, trace demands and other supplies. */
function coneOf(roots: Resource[]): Set<Resource> {
    const cone = new Set<Resource>();
    const queue = [...roots];
    while (queue.length > 0) {
        const r = queue.pop()!;
        if (cone.has(r)) continue;
        cone.add(r);
        const supplier = r.suppliedBy;
        if (supplier === null) continue;
        supplier.demands?.forEach((d) => queue.push(d));
        supplier.traceDemands?.forEach((d) => queue.push(d));
        // a supplier may read the current value of anything it supplies without demanding it
        supplier.supplies?.forEach((d) => queue.push(d));
    }
    return cone;
}

function stateString<S>(opts: ExploreOptions<S>, b: Built<S>): string {
    const canon = new Canon(b.graphs, opts.opaque);
    const only = opts.cone ? coneOf(opts.cone(b.sys, b.graphs)) : null;
    const parts: string[] = [];
    for (const g of b.graphs) {
        for (const ext of g.extents) parts.push(canon.extent(ext, only));
        parts.push("/");
    }
    if (opts.envKey) parts.push("env:" + canon.value(opts.envKey(b.sys)));
    return parts.join("\n");
}

/** 106-bit string hash (two 53-bit cyrb53 lanes). */
function hash(s: string): string {
    const lane = (seed: number) => {
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
    return lane(0) + ":" + lane(0x9e3779b9) + ":" + s.length.toString(36);
}

// ---------------------------------------------------------------------------------------------
// Search

interface Node {
    prefix: ExploreStep[];
    /** Steps not to take from here, with their footprints (sleep sets). */
    sleep: Map<string, Footprint>;
    /** Re-expansion of a state seen before: take only these steps (the rest were taken). */
    only: Set<string> | null;
    /** The state hash this prefix reached when it was first run, to catch nondeterminism. */
    hash: string;
}

/** Explores every input sequence up to `opts.depth`. See the module comment. */
export function explore<S>(opts: ExploreOptions<S>): ExploreResult {
    const restore = guardNondeterminism();
    try {
        return (opts.mode ?? "bfs") === "random" ? randomWalks(opts) : bfs(opts);
    } finally {
        restore();
    }
}

/** Graphs of the system being stepped, for the nondeterminism guard. */
let activeGraphs: Graph[] = [];

/**
 * While explore runs, `Date.now()` and `Math.random()` throw inside a behavior: their results
 * would differ on replay and the search would silently merge or miss states. Read time from
 * `graph.dateProvider` or an injected clock, and randomness from an input.
 */
function guardNondeterminism(): () => void {
    const now = Date.now;
    const random = Math.random;
    const inBehavior = () => activeGraphs.some((g) => g.currentBehavior !== null);
    Date.now = () => {
        if (inBehavior()) throw new Error("explore: Date.now() inside a behavior is not replayable; use graph.dateProvider or an injected clock");
        return now();
    };
    Math.random = () => {
        if (inBehavior()) throw new Error("explore: Math.random() inside a behavior is not replayable; pass randomness in as an input");
        return random();
    };
    return () => {
        Date.now = now;
        Math.random = random;
    };
}

function bfs<S>(opts: ExploreOptions<S>): ExploreResult {
    const start = Date.now();
    const actions = actionByName(opts);
    const maxStates = opts.maxStates ?? 1_000_000;
    const sleepOn = opts.reduction === "sleep";
    const stats: ExploreStats = {states: 0, transitions: 0, stepsRun: 0, slept: 0, depthCompleted: 0, truncated: false, ms: 0};
    const finish = (r: Omit<ExploreResult, "stats">): ExploreResult => {
        stats.ms = Date.now() - start;
        return {...r, stats};
    };

    const root = build(opts.setup);
    const visited = new Map<string, Set<string> | null>();
    const rootHash = hash(stateString(opts, root));
    visited.set(rootHash, sleepOn ? new Set() : null);
    stats.states = 1;
    let frontier: Node[] = [{prefix: [], sleep: new Map(), only: null, hash: rootHash}];

    for (let depth = 1; depth <= opts.depth; depth++) {
        const next: Node[] = [];
        // nodes queued for the next level by state, so a revisit can shrink their sleep set in place
        const queued = new Map<string, Node>();
        for (const node of frontier) {
            const here = replayPrefix(opts, actions, node.prefix);
            stats.stepsRun += node.prefix.length;
            if (hash(stateString(opts, here)) !== node.hash) {
                throw new Error(`explore: replaying ${node.prefix.length} step(s) reached a different state than the first run. Something is not deterministic: setup(), a step, Date or randomness, or state outside the graphs that envKey does not cover.`);
            }
            const candidates = enabledSteps(opts, here);
            // footprints of the siblings already taken from this node, for their sleep sets
            const done = new Map<string, Footprint>();
            let fresh: Built<S> | null = here;
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
                    return finish({ok: false, counterexample: {steps: prefix, violations: out.violations, provenance: out.provenance}});
                }
                let childSleep = new Map<string, Footprint>();
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
                        const child: Node = {prefix, sleep: childSleep, only: null, hash: h};
                        next.push(child);
                        queued.set(h, child);
                    }
                    if (stats.states >= maxStates) {
                        stats.truncated = true;
                        return finish({ok: true});
                    }
                } else if (sleepOn) {
                    // Seen before with sleep set `old`: steps in `old` but not in the new one were
                    // never taken from that state. If its node is still queued, shrink its sleep
                    // set; otherwise expand it again for just those steps.
                    const old = visited.get(h)!;
                    const missing = new Set<string>();
                    for (const k of old) if (!childSleep.has(k)) missing.add(k);
                    if (missing.size > 0) {
                        const meet = new Map<string, Footprint>();
                        for (const [k, f] of childSleep) if (old.has(k)) meet.set(k, f);
                        visited.set(h, new Set(meet.keys()));
                        const pending = queued.get(h);
                        if (pending !== undefined) {
                            for (const k of missing) pending.sleep.delete(k);
                        } else if (depth < opts.depth) {
                            next.push({prefix, sleep: meet, only: missing, hash: h});
                        }
                    }
                }
            }
        }
        stats.depthCompleted = depth;
        frontier = next;
        if (frontier.length === 0) break;
    }
    return finish({ok: true});
}

/** mulberry32 */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomWalks<S>(opts: ExploreOptions<S>): ExploreResult {
    const start = Date.now();
    const actions = actionByName(opts);
    const rand = prng(opts.seed ?? 1);
    const walks = opts.walks ?? 1000;
    const seen = new Set<string>();
    const stats: ExploreStats = {states: 0, transitions: 0, stepsRun: 0, slept: 0, depthCompleted: 0, truncated: false, ms: 0};
    for (let w = 0; w < walks; w++) {
        const b = build(opts.setup);
        const steps: ExploreStep[] = [];
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
                return {ok: false, counterexample: {steps, violations: out.violations, provenance: out.provenance}, stats};
            }
            seen.add(hash(stateString(opts, b)));
        }
    }
    stats.states = seen.size;
    stats.depthCompleted = opts.depth;
    stats.ms = Date.now() - start;
    return {ok: true, stats};
}
