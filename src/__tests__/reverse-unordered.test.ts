//
//  Copyright Yahoo 2021
//

import {Graph, Extent, State} from "../index.js";

// Behaviors with no dependency path between them run in an order the graph does not promise.
// `graph.reverseUnordered` runs them in a different valid order so tests can catch output that
// depends on it.

class FanOut extends Extent {
    m = this.moment();
    out: number[] = [];
    constructor(g: Graph, n: number) {
        super(g);
        for (let i = 0; i < n; i++) {
            this.behavior().demands(this.m).runs(ext => {
                ext.sideEffect(() => ext.out.push(i));
            });
        }
    }
}

// one sink right after the moment, one sink three levels down; no path between them
class TwoDepths extends Extent {
    m = this.moment();
    a = this.state(0);
    b = this.state(0);
    out: string[] = [];
    constructor(g: Graph) {
        super(g);
        this.behavior().demands(this.m).runs(ext => {
            ext.sideEffect(() => ext.out.push("shallow"));
        });
        this.behavior().demands(this.m).supplies(this.a).runs(ext => {
            ext.a.update(ext.a.value + 1);
            ext.sideEffect(() => ext.out.push("a"));
        });
        this.behavior().demands(this.a).supplies(this.b).runs(ext => {
            ext.b.update(ext.b.value + 1);
            ext.sideEffect(() => ext.out.push("b"));
        });
        this.behavior().demands(this.b).runs(ext => {
            ext.sideEffect(() => ext.out.push("deep"));
        });
    }
}

function run<T extends Extent & {m: any}>(ext: T): T {
    ext.addToGraphWithAction();
    ext.m.updateWithAction();
    return ext;
}

describe('reverseUnordered', () => {

    afterEach(() => {
        Graph.reverseUnorderedDefault = false;
    });

    test('off by default; same-level behaviors run in activation order', () => {
        let g = new Graph();
        expect(g.reverseUnordered).toBe(false);
        expect(run(new FanOut(g, 5)).out).toEqual([0, 1, 2, 3, 4]);
    });

    test('reverses same-level behaviors', () => {
        let g = new Graph();
        g.reverseUnordered = true;
        expect(run(new FanOut(g, 5)).out).toEqual([4, 3, 2, 1, 0]);
    });

    test('reverses unrelated behaviors at different levels', () => {
        let g1 = new Graph();
        expect(run(new TwoDepths(g1)).out).toEqual(["shallow", "a", "b", "deep"]);

        let g2 = new Graph();
        g2.reverseUnordered = true;
        let out = run(new TwoDepths(g2)).out;
        // the dependency chain keeps its order; the unrelated sink moves to after it
        expect(out).toEqual(["a", "b", "deep", "shallow"]);
    });

    test('keeps every dependency in order', () => {
        // diamond: m -> left, right -> join; plus an unrelated sink
        class Diamond extends Extent {
            m = this.moment();
            left = this.state(0);
            right = this.state(0);
            log: string[] = [];
            constructor(g: Graph) {
                super(g);
                this.behavior().demands(this.m).supplies(this.left).runs(ext => {
                    ext.log.push("left");
                    ext.left.update(1);
                });
                this.behavior().demands(this.m).supplies(this.right).runs(ext => {
                    ext.log.push("right");
                    ext.right.update(1);
                });
                this.behavior().demands(this.left, this.right).runs(ext => {
                    ext.log.push("join:" + (ext.left.value + ext.right.value));
                });
                this.behavior().demands(this.m).runs(ext => {
                    ext.log.push("sink");
                });
            }
        }
        for (let reversed of [false, true]) {
            let g = new Graph();
            g.reverseUnordered = reversed;
            let d = run(new Diamond(g));
            expect(d.log.indexOf("join:2")).toBeGreaterThan(d.log.indexOf("left"));
            expect(d.log.indexOf("join:2")).toBeGreaterThan(d.log.indexOf("right"));
            expect(d.log.length).toBe(4);
        }
    });

    test('reverseUnorderedDefault applies to graphs created afterwards', () => {
        let before = new Graph();
        Graph.reverseUnorderedDefault = true;
        let after = new Graph();
        expect(before.reverseUnordered).toBe(false);
        expect(after.reverseUnordered).toBe(true);
        expect(run(new FanOut(after, 3)).out).toEqual([2, 1, 0]);
    });

    test('can be switched between events', () => {
        let g = new Graph();
        let f = run(new FanOut(g, 3));
        g.reverseUnordered = true;
        f.m.updateWithAction();
        g.reverseUnordered = false;
        f.m.updateWithAction();
        expect(f.out).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
    });

    test('orders extents added during the event by their links', () => {
        // a parent adds children in one event; each child's behavior demands the parent's
        // state, which a later parent behavior supplies, and a sink unrelated to the children
        class Child extends Extent {
            seen: number[] = [];
            constructor(g: Graph, parent: Parent) {
                super(g);
                this.behavior().demands(this.addedToGraph, parent.total).runs(ext => {
                    ext.seen.push(parent.total.value);
                });
            }
        }
        class Parent extends Extent {
            add = this.moment<number>();
            count = this.state(0);
            total: State<number> = this.state(0);
            children: Child[] = [];
            constructor(g: Graph) {
                super(g);
                this.behavior().demands(this.add).supplies(this.count).runs(ext => {
                    ext.count.update(ext.count.value + ext.add.value!);
                    for (let i = 0; i < ext.add.value!; i++) {
                        let c = new Child(ext.graph, ext);
                        ext.addChildLifetime(c);
                        c.addToGraph();
                        ext.children.push(c);
                    }
                });
                this.behavior().demands(this.count).supplies(this.total).runs(ext => {
                    ext.total.update(ext.count.value * 10);
                });
            }
        }
        for (let reversed of [false, true]) {
            let g = new Graph();
            g.reverseUnordered = reversed;
            let p = new Parent(g);
            p.addToGraphWithAction();
            p.add.updateWithAction(3);
            expect(p.children.map(c => c.seen)).toEqual([[30], [30], [30]]);
        }
    });

    test('a child removed by an ordered parent behavior is skipped in both orders', () => {
        // the child's handler takes an .order demand on the parent's cancel, so it always runs
        // after it and is skipped once its extent is removed
        class Kid extends Extent {
            result = this.moment<string>();
            runs = 0;
            constructor(g: Graph, cancelled: any) {
                super(g);
                this.behavior().demands(this.result, cancelled.order).runs(ext => { ext.runs++; });
            }
        }
        class Parent extends Extent {
            interrupt = this.moment();
            cancelled = this.resource();
            kid: Kid;
            constructor(g: Graph) {
                super(g);
                this.kid = new Kid(g, this.cancelled);
                this.addChildLifetime(this.kid);
                this.behavior().demands(this.interrupt).supplies(this.cancelled).runs(ext => {
                    ext.kid.removeFromGraph();
                });
            }
        }
        for (let reversed of [false, true]) {
            let g = new Graph();
            g.reverseUnordered = reversed;
            let p = new Parent(g);
            g.action(() => { p.addToGraph(); p.kid.addToGraph(); });
            g.action(() => { p.kid.result.update("done"); p.interrupt.update(); });
            expect(p.kid.runs).toBe(0);
            expect(p.kid.addedToGraph.value).toBe(false);
        }
    });

    test('exposes output order that depends on unrelated behaviors', () => {
        // two behaviors log from their own side effects; the test that checks the log passes
        // only in the order the graph happens to pick
        class Spread extends Extent {
            m = this.moment();
            log: string[] = [];
            constructor(g: Graph) {
                super(g);
                this.behavior().demands(this.m).runs(ext => ext.sideEffect(() => ext.log.push("first")));
                this.behavior().demands(this.m).runs(ext => ext.sideEffect(() => ext.log.push("second")));
            }
        }
        let normal = new Graph();
        let reversed = new Graph();
        reversed.reverseUnordered = true;
        expect(run(new Spread(normal)).log).toEqual(["first", "second"]);
        expect(run(new Spread(reversed)).log).toEqual(["second", "first"]);

        // the fix: an .order demand gives the pair an order, and reversing no longer changes it
        class Ordered extends Extent {
            m = this.moment();
            firstDone = this.resource();
            log: string[] = [];
            constructor(g: Graph) {
                super(g);
                this.behavior().demands(this.m).supplies(this.firstDone).runs(ext => ext.sideEffect(() => ext.log.push("first")));
                this.behavior().demands(this.m, this.firstDone.order).runs(ext => ext.sideEffect(() => ext.log.push("second")));
            }
        }
        let g = new Graph();
        g.reverseUnordered = true;
        expect(run(new Ordered(g)).log).toEqual(["first", "second"]);
    });
});
