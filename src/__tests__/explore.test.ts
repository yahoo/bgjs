//
//  Copyright Yahoo 2026
//

import {Extent, Graph, State, explore, replayExplore, exploreTouch, ExploreOptions} from '../index.js';

/** A counter that wraps at `limit`; `doubled` is derived. */
class Counter extends Extent {
    count: State<number> = this.state(0);
    doubled: State<number> = this.state(0);

    constructor(graph: Graph, limit: number, bugAt: number | null) {
        super(graph);
        this.behavior()
            .demands(this.count)
            .supplies(this.doubled)
            .runs((ext) => {
                // planted bug: off by one at one value
                ext.doubled.update(ext.count.value === bugAt ? 2 * ext.count.value + 1 : 2 * ext.count.value);
            });
        this.limit = limit;
    }
    limit: number;
}

/** Two independent counters, plus an optional cross check that throws (an invariant as a behavior). */
class Pair extends Extent {
    a: Counter;
    b: Counter;
    constructor(graph: Graph, bugAt: number | null, crossCheck: boolean) {
        super(graph);
        this.a = new Counter(graph, 3, bugAt);
        this.b = new Counter(graph, 3, null);
        this.unifyLifetime(this.a);
        this.unifyLifetime(this.b);
        if (crossCheck) {
            this.behavior()
                .demands(this.a.doubled, this.b.doubled)
                .runs((ext) => {
                    if (ext.a.doubled.value % 2 !== 0) throw new Error(`a.doubled is odd: ${ext.a.doubled.value}`);
                });
        }
    }
}

function options(bugAt: number | null, crossCheck: boolean, depth: number): ExploreOptions<Pair> {
    return {
        setup: () => {
            const g = new Graph();
            const p = new Pair(g, bugAt, crossCheck);
            g.action(() => {
                p.addToGraph();
                p.a.addToGraph();
                p.b.addToGraph();
            });
            return p;
        },
        actions: [
            {name: "incA", run: (p) => p.a.count.updateWithAction((p.a.count.value + 1) % p.a.limit)},
            {name: "incB", run: (p) => p.b.count.updateWithAction((p.b.count.value + 1) % p.b.limit)},
        ],
        depth,
    };
}

describe('explore', () => {

    test('visits each state once', () => {
        const r = explore(options(null, false, 10));
        expect(r.ok).toBe(true);
        expect(r.stats.states).toBe(9);
        expect(r.stats.truncated).toBe(false);
    });

    test('finds a violation from a check, with the shortest sequence', () => {
        const opts: ExploreOptions<Pair> = {
            ...options(null, false, 10),
            checks: [(p) => p.a.count.value === 2 && p.b.count.value === 1 ? "a=2 and b=1" : undefined],
        };
        const r = explore(opts);
        expect(r.ok).toBe(false);
        expect(r.counterexample!.steps.length).toBe(3);
        expect(r.counterexample!.violations).toEqual(["a=2 and b=1"]);
        // the counterexample replays in a fresh system
        const replay = replayExplore(opts, r.counterexample!.steps);
        expect(replay.failedAt).toBe(3);
        expect(replay.sys.a.count.value).toBe(2);
    });

    test('an invariant can be a behavior that throws, with provenance', () => {
        const r = explore(options(2, true, 10));
        expect(r.ok).toBe(false);
        expect(r.counterexample!.steps).toEqual([{action: "incA"}, {action: "incA"}]);
        expect(r.counterexample!.violations[0]).toMatch(/a.doubled is odd: 5/);
        expect(r.counterexample!.provenance.updated).toEqual(["Counter.count", "Counter.doubled"]);
    });

    test('inputs and enabled', () => {
        const opts: ExploreOptions<Pair> = {
            ...options(null, false, 2),
            actions: [{
                name: "setA",
                inputs: [0, 1, 2],
                enabled: (p, v) => v !== p.a.count.value,
                run: (p, v: number) => p.a.count.updateWithAction(v),
            }],
            checks: [(p) => p.a.doubled.value === 4 ? "reached 4" : undefined],
        };
        const r = explore(opts);
        expect(r.counterexample!.steps).toEqual([{action: "setA", input: 2}]);
    });

    test('sleep sets skip commuting orders of independent steps', () => {
        const full = explore(options(null, false, 10));
        const reduced = explore({...options(null, false, 10), reduction: "sleep"});
        expect(reduced.ok).toBe(true);
        expect(reduced.stats.states).toBe(9);
        expect(reduced.stats.slept).toBeGreaterThan(0);
        expect(reduced.stats.transitions).toBeLessThan(full.stats.transitions);
    });

    test('sleep sets still find the bug', () => {
        const opts = {...options(null, false, 10), reduction: "sleep" as const, checks: [(p: Pair) => p.a.count.value === 2 && p.b.count.value === 2 ? "both 2" : undefined]};
        const r = explore(opts);
        expect(r.ok).toBe(false);
        expect(r.counterexample!.steps.length).toBe(4);
    });

    test('a shared environment key makes steps dependent', () => {
        const opts: ExploreOptions<Pair> = {
            ...options(null, false, 10),
            reduction: "sleep",
            actions: options(null, false, 10).actions.map((a) => ({...a, run: (p: Pair, i: unknown) => { exploreTouch("log", "write"); a.run(p, i); }})),
        };
        const r = explore(opts);
        expect(r.stats.slept).toBe(0);
    });

    test('cone of influence merges states that differ only outside the cone', () => {
        const opts: ExploreOptions<Pair> = {...options(null, false, 10), cone: (p) => [p.a.doubled]};
        const r = explore(opts);
        expect(r.ok).toBe(true);
        expect(r.stats.states).toBe(3);
    });

    test('plain extent fields are part of the state', () => {
        class Tally extends Extent {
            n: number = 0;
            tick = this.moment();
            constructor(g: Graph) {
                super(g);
                this.behavior().demands(this.tick).runs((ext) => ext.sideEffect((e) => { e.n = (e.n + 1) % 4; }));
            }
        }
        const r = explore<Tally>({
            setup: () => { const t = new Tally(new Graph()); t.addToGraphWithAction(); return t; },
            actions: [{name: "tick", run: (t) => t.tick.updateWithAction()}],
            depth: 10,
        });
        expect(r.stats.states).toBe(4);
    });

    test('Date.now inside a behavior throws during explore', () => {
        class Clocked extends Extent {
            tick = this.moment();
            at = this.state(0);
            constructor(g: Graph) {
                super(g);
                this.behavior().demands(this.tick).supplies(this.at).runs((ext) => ext.at.update(Date.now()));
            }
        }
        const r = explore<Clocked>({
            setup: () => { const c = new Clocked(new Graph()); c.addToGraphWithAction(); return c; },
            actions: [{name: "tick", run: (c) => c.tick.updateWithAction()}],
            depth: 2,
        });
        expect(r.counterexample!.violations[0]).toMatch(/Date.now\(\) inside a behavior/);
        expect(typeof Date.now()).toBe("number");
    });

    test('state outside the graph that envKey misses is caught on replay', () => {
        let leaked = 0; // shared across systems: not replayable
        class Leaky extends Extent {
            n = this.state(0);
        }
        expect(() => explore<Leaky>({
            setup: () => { const l = new Leaky(new Graph()); l.addToGraphWithAction(); return l; },
            actions: [{name: "inc", run: (l) => l.n.updateWithAction(++leaked)}],
            depth: 3,
        })).toThrow(/not deterministic/);
    });

    test('random walks', () => {
        const r = explore({...options(2, true, 6), mode: "random", walks: 200, seed: 3});
        expect(r.ok).toBe(false);
        expect(r.counterexample!.violations[0]).toMatch(/odd/);
    });
});
