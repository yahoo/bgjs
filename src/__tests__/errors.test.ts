//
//  Copyright Yahoo 2021
//

// Error messages name the resources and behaviors involved and the API to change. These tests
// assert only those names, not the wording around them.

import {Extent, Graph} from '../index.js';

class Player extends Extent {
    loadReq = this.moment();
    seq = this.state(0);
    engineAccepted = this.moment();
    advance = this.moment();
    countdown = this.state(0);
    input = this.state(0);
}

// every `.name(` a message mentions must be a real method
function expectApisExist(msg: string) {
    let p = new Player(new Graph());
    let targets: any[] = [p, p.behavior(), p.seq, p.loadReq];
    for (let [, name] of msg.matchAll(/\.(\w+)\(/g)) {
        expect(targets.some(t => typeof t[name] == "function") ? name : `missing API ${name}`).toBe(name);
    }
}

function thrown(fn: () => void): any {
    try {
        fn();
    } catch (e: any) {
        expectApisExist(e.message);
        return e;
    }
    throw new Error("expected a throw");
}

describe('cycle errors', () => {
    test('labels each behavior on the loop and offers the fixes that apply', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.advance).supplies(p.loadReq).runs(() => {});
        p.behavior().demands(p.loadReq).supplies(p.seq).runs(() => {});
        p.behavior().demands(p.seq).supplies(p.engineAccepted).runs(() => {});
        p.behavior().demands(p.engineAccepted).supplies(p.countdown, p.advance).runs(() => {});
        let err = thrown(() => p.addToGraphWithAction());
        let msg: string = err.message;
        // one line per behavior: its label, its supplies, its demand on the loop and the next label
        let edges = [...msg.matchAll(/^ +(B\d) \(Player, supplies \[([^\]]*)\]\) demands "(\w+)", supplied by (B\d)$/gm)];
        expect(edges).toHaveLength(4);
        expect(edges.map(e => e[3])).toEqual(err.cycle.map((r: any) => r.debugName));
        expect(edges.map(e => e[4])).toEqual(["B2", "B3", "B4", "B1"]);
        let demanderOf = (name: string) => edges.find(e => e[3] == name)![1];
        // seq is the only state on the loop, so its demander gets the only traceValue fix
        expect(msg.match(/\w+\.traceValue/g)).toEqual(["seq.traceValue"]);
        expect(msg).toContain(`${demanderOf("seq")} could demand seq.trace`);
        // the countdown owner supplies two resources: the split fix names it and both supplies
        expect(msg).toMatch(new RegExp(`${demanderOf("engineAccepted")} also supplies \\[countdown\\].*If advance does not need engineAccepted`));
    });

    test('a loop of moments offers no traceValue fix and no split fix', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.advance).supplies(p.loadReq).runs(() => {});
        p.behavior().demands(p.loadReq).supplies(p.advance).runs(() => {});
        let msg: string = thrown(() => p.addToGraphWithAction()).message;
        expect(msg).toMatch(/B1 .*demands "advance", supplied by B2/);
        expect(msg).toMatch(/B2 .*demands "loadReq", supplied by B1/);
        expect(msg).not.toContain("traceValue");
        expect(msg).not.toContain("also supplies");
    });

    test('a behavior that demands what it supplies', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.countdown).supplies(p.countdown).runs(() => {});
        let msg: string = thrown(() => p.addToGraphWithAction()).message;
        expect(msg).toContain('remove "countdown"');
        expect(msg).not.toMatch(/B\d/);
    });
});

describe('access and update errors', () => {
    test('undeclared read names the resource, the behavior and the fixes', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.input).supplies(p.countdown).runs(ext => {
            ext.countdown.update(ext.seq.value + 1);
        });
        p.behavior().demands(p.loadReq).supplies(p.seq).runs(() => {});
        p.addToGraphWithAction();
        let msg: string = thrown(() => p.input.updateWithAction(1)).message;
        expect(msg).toContain('"seq"');
        expect(msg).toContain("supplies [countdown] and demands [input]");
        expect(msg).toContain(".demands(");
        expect(msg).toContain("seq.trace ");
        expect(msg).toContain("seq.traceValue");
    });

    test('undeclared read of a moment has no traceValue fix', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.input).supplies(p.countdown).runs(ext => {
            ext.advance.justUpdated;
        });
        p.addToGraphWithAction();
        let msg: string = thrown(() => p.input.updateWithAction(1)).message;
        expect(msg).toContain('"advance"');
        expect(msg).not.toContain("traceValue");
    });

    test('update from a second behavior names both behaviors', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.loadReq).supplies(p.seq).runs(() => {});
        p.behavior().demands(p.input).supplies(p.countdown).runs(ext => {
            ext.seq.update(5);
        });
        p.addToGraphWithAction();
        let msg: string = thrown(() => p.input.updateWithAction(1)).message;
        expect(msg).toContain('"seq"');
        expect(msg).toContain("supplies [countdown] and demands [input]");
        expect(msg).toContain("supplies [seq] and demands [loadReq]");
    });

    test('update of an input from a behavior points at supplies and actions', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.loadReq).supplies(p.countdown).runs(ext => {
            ext.input.update(2);
        });
        p.addToGraphWithAction();
        let msg: string = thrown(() => p.loadReq.updateWithAction()).message;
        expect(msg).toContain('"input"');
        expect(msg).toContain("supplies [countdown] and demands [loadReq]");
        expect(msg).toContain(".supplies(");
        expect(msg).toContain(".action(");
    });

    test('update outside any event points at actions', () => {
        let g = new Graph();
        let p = new Player(g);
        p.addToGraphWithAction();
        let msg: string = thrown(() => p.input.update(3)).message;
        expect(msg).toContain('"input"');
        expect(msg).toContain(".action(");
    });
});

describe('graph membership errors', () => {
    test('static demand without a lifetime relationship names the extent and the lifetime APIs', () => {
        let g = new Graph();
        let other = new Player(g);
        other.debugName = "Other";
        other.addToGraphWithAction();
        let p = new Player(g);
        p.behavior().demands(other.seq).supplies(p.countdown).runs(() => {});
        let msg: string = thrown(() => p.addToGraphWithAction()).message;
        expect(msg).toMatch(/^The behavior in Player/);
        expect(msg).toContain('"seq" of Other');
        expect(msg).toContain("Other.addChildLifetime(");
        expect(msg).toContain("Other.unifyLifetime(");
        expect(msg).toContain("dynamicDemands");
    });

    test('static supply without a lifetime relationship names the extent', () => {
        let g = new Graph();
        let other = new Player(g);
        other.debugName = "Other";
        other.addToGraphWithAction();
        let p = new Player(g);
        p.behavior().demands(p.input).supplies(other.seq).runs(() => {});
        let msg: string = thrown(() => p.addToGraphWithAction()).message;
        expect(msg).toContain('"seq" of Other');
        expect(msg).toContain("dynamicSupplies");
    });

    test('demand on an extent never added names its resource', () => {
        let g = new Graph();
        g.validateLifetimes = false;
        let other = new Player(g);
        other.debugName = "Other";
        let p = new Player(g);
        p.behavior().demands(other.seq).supplies(p.countdown).runs(() => {});
        let msg: string = thrown(() => p.addToGraphWithAction()).message;
        expect(msg).toMatch(/^The behavior in Player/);
        expect(msg).toContain('"seq"');
        expect(msg).toContain("Other");
        expect(msg).not.toContain("unnamed");
    });
});

function strictGraph(): Graph {
    let g = new Graph();
    g.validateTraceDemands = true;
    return g;
}

describe('trace demands', () => {
    test('reading traceValue of an undemanded state without .trace names both fixes', () => {
        let g = strictGraph();
        let p = new Player(g);
        p.behavior().demands(p.input).supplies(p.countdown).runs(ext => {
            ext.countdown.update(ext.seq.traceValue + 1);
        });
        p.behavior().demands(p.loadReq).supplies(p.seq).runs(() => {});
        p.addToGraphWithAction();
        let err = thrown(() => p.input.updateWithAction(1));
        let msg: string = err.message;
        expect(msg).toContain('"seq.traceValue"');
        expect(msg).toContain("supplies [countdown] and demands [input]");
        expect(msg).toContain("seq.trace ");
        expect(msg).toContain(".demands(");
        expect(msg).toContain("seq.value");
        expect(err.resource).toBe(p.seq);
    });

    test('off by default: undeclared trace reads are permitted', () => {
        let g = new Graph();
        expect(g.validateTraceDemands).toBe(false);
        let p = new Player(g);
        p.behavior().demands(p.input).supplies(p.countdown).runs(ext => {
            ext.countdown.update(ext.seq.traceValue + 1);
        });
        p.addToGraphWithAction();
        p.input.updateWithAction(1);
        expect(p.countdown.value).toBe(1);
    });

    test('traceEvent is checked the same way', () => {
        let g = strictGraph();
        let p = new Player(g);
        p.behavior().demands(p.input).supplies(p.countdown).runs(ext => {
            ext.seq.traceEvent;
        });
        p.addToGraphWithAction();
        expect(thrown(() => p.input.updateWithAction(1)).message).toContain('"seq.traceValue"');
    });

    test('.trace permits the read, gives the value from before the event, and is not an edge', () => {
        let g = strictGraph();
        let p = new Player(g);
        let seen: number[] = [];
        let runs = 0;
        // seq's owner demands countdown, and countdown's owner reads seq's previous value:
        // a cycle if it were a normal demand.
        p.behavior().demands(p.loadReq, p.countdown).supplies(p.seq).runs(ext => {
            if (ext.loadReq.justUpdated) ext.seq.update(ext.seq.value + 1);
        });
        p.behavior().demands(p.input, p.seq.trace).supplies(p.countdown).runs(ext => {
            runs++;
            seen.push(ext.seq.traceValue);
            ext.countdown.update(ext.input.value);
        });
        p.addToGraphWithAction();
        runs = 0;
        g.action(() => { p.loadReq.update(); p.input.update(7); });
        // the read is the value before this event even though seq updated in it
        expect(seen[seen.length - 1]).toBe(0);
        expect(p.seq.value).toBe(1);
        // updating seq alone does not run the trace-demanding behavior
        runs = 0;
        p.loadReq.updateWithAction();
        expect(runs).toBe(0);
    });

    test('.trace does not permit reading value', () => {
        let g = strictGraph();
        let p = new Player(g);
        p.behavior().demands(p.input, p.seq.trace).supplies(p.countdown).runs(ext => {
            ext.countdown.update(ext.seq.value);
        });
        p.addToGraphWithAction();
        let msg: string = thrown(() => p.input.updateWithAction(1)).message;
        expect(msg).toContain('"seq"');
        expect(msg).not.toContain('"seq.traceValue"');
    });

    test('supplier and reactive demanders read traceValue without .trace', () => {
        let g = strictGraph();
        let p = new Player(g);
        let fromDemander = -1;
        p.behavior().demands(p.loadReq).supplies(p.seq).runs(ext => {
            ext.seq.update(ext.seq.traceValue + 1);
        });
        p.behavior().demands(p.seq).supplies(p.countdown).runs(ext => {
            fromDemander = ext.seq.traceValue;
            if (ext.seq.justUpdatedFrom(0)) ext.countdown.update(1);
        });
        p.behavior().demands(p.seq.order).supplies(p.input).runs(ext => {
            ext.input.update(ext.seq.traceValue);
        });
        p.addToGraphWithAction();
        p.loadReq.updateWithAction();
        expect(p.seq.value).toBe(1);
        expect(fromDemander).toBe(0);
        expect(p.countdown.value).toBe(1);
    });

    test('outside behaviors traceValue is readable anywhere', () => {
        let g = strictGraph();
        let p = new Player(g);
        p.addToGraphWithAction();
        let inSideEffect = -1;
        g.action(() => {
            p.seq.update(3);
            g.sideEffect(() => { inSideEffect = p.seq.traceValue; });
        });
        expect(inSideEffect).toBe(0);
        expect(p.seq.traceValue).toBe(3);
    });

    test('dynamic trace demands are honored and replaced', () => {
        let g = strictGraph();
        let p = new Player(g);
        let read = -1;
        p.behavior()
            .demands(p.input)
            .dynamicDemands([p.addedToGraph, p.loadReq], ext => ext.loadReq.justUpdated ? [] : [ext.seq.trace])
            .supplies(p.countdown)
            .runs(ext => { read = ext.seq.traceValue; });
        p.addToGraphWithAction();
        p.input.updateWithAction(1);
        expect(read).toBe(0);
        p.loadReq.updateWithAction();
        expect(thrown(() => p.input.updateWithAction(2)).message).toContain('"seq.traceValue"');
    });

    test('a trace demand is listed as name.trace when describing a behavior', () => {
        let g = strictGraph();
        let p = new Player(g);
        p.behavior().demands(p.input, p.countdown.trace).supplies(p.seq).runs(ext => {
            ext.engineAccepted.update();
        });
        p.behavior().demands(p.loadReq).supplies(p.engineAccepted).runs(() => {});
        p.addToGraphWithAction();
        expect(thrown(() => p.input.updateWithAction(1)).message).toContain("demands [input, countdown.trace]");
    });

    test('relinking a reactive demand to .trace removes the edge', () => {
        let g = strictGraph();
        let p = new Player(g);
        let runs = 0;
        p.behavior()
            .dynamicDemands([p.addedToGraph, p.loadReq], ext => ext.loadReq.justUpdated ? [ext.seq.trace] : [ext.seq])
            .supplies(p.countdown)
            .runs(() => { runs++; });
        p.behavior().demands(p.advance).supplies(p.seq).runs(ext => ext.seq.update(ext.seq.value + 1));
        p.addToGraphWithAction();
        runs = 0;
        p.advance.updateWithAction();
        expect(runs).toBe(1);
        p.loadReq.updateWithAction();
        runs = 0;
        p.advance.updateWithAction();
        expect(runs).toBe(0);
    });
});

describe('builder and extent mistakes', () => {
    test('a second .demands() call adds to the first', () => {
        let g = new Graph();
        let p = new Player(g);
        let runs = 0;
        p.behavior().demands(p.advance).supplies(p.loadReq).demands(p.engineAccepted).runs(() => { runs++; });
        p.addToGraphWithAction();
        p.advance.updateWithAction();
        p.engineAccepted.updateWithAction();
        expect(runs).toBe(2);
    });

    test('a second .supplies() call adds to the first', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.advance).supplies(p.seq).supplies(p.countdown).runs(ext => {
            ext.seq.update(1);
            ext.countdown.update(2);
        });
        p.addToGraphWithAction();
        p.advance.updateWithAction();
        expect(p.seq.value).toBe(1);
        expect(p.countdown.value).toBe(2);
    });

    test('a second dynamicDemands call throws and says to combine them', () => {
        let g = new Graph();
        let p = new Player(g);
        let msg = thrown(() => p.behavior()
            .dynamicDemands([p.advance], () => [p.seq])
            .dynamicDemands([p.loadReq], () => [p.countdown])).message;
        expect(msg).toContain(".dynamicDemands(...) was called twice");
        expect(msg).toContain("in Player");
    });

    test('a behavior whose demands are all .trace throws when built and names them', () => {
        let g = new Graph();
        let p = new Player(g);
        let msg = thrown(() => p.behavior().demands(p.seq.trace, p.countdown.trace).supplies(p.input).runs(() => {})).message;
        expect(msg).toContain("can never run");
        expect(msg).toContain("[seq.trace, countdown.trace]");
        expect(msg).toContain("supplies [input]");
        expect(msg).toContain("in Player");
    });

    test('.trace next to a reactive or dynamic demand is fine', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.seq.trace, p.advance).supplies(p.input).runs(() => {});
        p.behavior().demands(p.countdown.trace).dynamicDemands([p.loadReq], () => [p.engineAccepted]).runs(() => {});
        p.addToGraphWithAction();
    });

    test('a field that hides an Extent method throws at addToGraph and names it', () => {
        class Panel extends Extent {
            phase = this.state(0);
        }
        let g = new Graph();
        let panel = new Panel(g);
        (panel as any).state = panel.phase;
        let msg = thrown(() => panel.addToGraphWithAction()).message;
        expect(msg).toContain('Panel has a field named "state"');
        expect(msg).toContain("rename the field");
    });

    test('a field that replaces an Extent field throws at addToGraph', () => {
        class Panel extends Extent {
            phase = this.state(0);
        }
        let g = new Graph();
        let panel = new Panel(g);
        (panel as any).addedToGraph = 3;
        let msg = thrown(() => panel.addToGraphWithAction()).message;
        expect(msg).toContain('field named "addedToGraph"');
    });
});
