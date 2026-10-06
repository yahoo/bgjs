//
//  Copyright Yahoo 2021
//

// Agent-legible error text: every message names the resources and behaviors involved and says
// what to change (bgevals bge-z78.2).

import {Extent, Graph} from '../index.js';

function thrown(fn: () => void): Error {
    try {
        fn();
    } catch (e) {
        return e as Error;
    }
    throw new Error("expected a throw");
}

class Player extends Extent {
    loadReq = this.moment();
    seq = this.state(0);
    engineAccepted = this.moment();
    advance = this.moment();
    countdown = this.state(0);
    input = this.state(0);
}

describe('cycle errors', () => {
    test('names every behavior and resource on the loop and the fixes', () => {
        let g = new Graph();
        let p = new Player(g);
        // the round 14 shape: advance -> loadReq -> seq -> engineAccepted -> countdown owner
        p.behavior().demands(p.advance).supplies(p.loadReq).runs(() => {});
        p.behavior().demands(p.loadReq).supplies(p.seq).runs(() => {});
        p.behavior().demands(p.seq).supplies(p.engineAccepted).runs(() => {});
        p.behavior().demands(p.engineAccepted).supplies(p.countdown, p.advance).runs(() => {});
        let err: any = thrown(() => p.addToGraphWithAction());
        let msg = err.message;
        expect(msg).toMatch(/^Behavior dependency cycle detected: 4 behaviors/);
        for (let name of ["advance", "loadReq", "seq", "engineAccepted"]) {
            expect(msg).toContain(`demands "${name}"`);
        }
        expect(msg).toContain("closing the loop");
        expect(msg).toContain("in Player");
        // seq is the only state on the loop, so it is the only traceValue candidate
        expect(msg).toMatch(/on this loop: B\d reads seq\.traceValue\)/);
        // the countdown owner supplies two resources: the split hint names it
        expect(msg).toMatch(/B\d supplies more than one resource/);
        expect(err.cycle).toHaveLength(4);
    });

    test('a behavior that demands what it supplies', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.countdown).supplies(p.countdown).runs(() => {});
        let msg = thrown(() => p.addToGraphWithAction()).message;
        expect(msg).toContain('remove "countdown" from its demands');
    });

    test('a loop of moments says traceValue does not apply', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.advance).supplies(p.loadReq).runs(() => {});
        p.behavior().demands(p.loadReq).supplies(p.advance).runs(() => {});
        let msg = thrown(() => p.addToGraphWithAction()).message;
        expect(msg).toContain("every resource on the loop is a moment".replace(/^e/, "E"));
    });
});

describe('access and update errors', () => {
    test('undeclared read names the resource, the behavior and the fix', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.input).supplies(p.countdown).runs(ext => {
            ext.countdown.update(ext.seq.value + 1);
        });
        p.behavior().demands(p.loadReq).supplies(p.seq).runs(() => {});
        p.addToGraphWithAction();
        let msg = thrown(() => p.input.updateWithAction(1)).message;
        expect(msg).toContain('Cannot read "seq"');
        expect(msg).toContain("supplies [countdown] and demands [input]");
        expect(msg).toContain("add seq to this behavior's .demands(...)");
        expect(msg).toContain("supplies [seq] and demands [loadReq]");
        expect(msg).toContain("seq.traceValue");
    });

    test('update from a second behavior names the supplier', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.loadReq).supplies(p.seq).runs(() => {});
        p.behavior().demands(p.input).supplies(p.countdown).runs(ext => {
            ext.seq.update(5);
        });
        p.addToGraphWithAction();
        let msg = thrown(() => p.input.updateWithAction(1)).message;
        expect(msg).toContain('Cannot update "seq" from the behavior in Player that supplies [countdown]');
        expect(msg).toContain('"seq" is supplied by the behavior in Player that supplies [seq]');
        expect(msg).toContain("Do not add a second supplier");
    });

    test('update of an input from a behavior says to supply it or use an action', () => {
        let g = new Graph();
        let p = new Player(g);
        p.behavior().demands(p.loadReq).supplies(p.countdown).runs(ext => {
            ext.input.update(2);
        });
        p.addToGraphWithAction();
        let msg = thrown(() => p.loadReq.updateWithAction()).message;
        expect(msg).toContain('Cannot update "input"');
        expect(msg).toContain("has no supplier");
        expect(msg).toContain(".supplies(...)");
    });

    test('update outside any event names the resource and the fix', () => {
        let g = new Graph();
        let p = new Player(g);
        p.addToGraphWithAction();
        let msg = thrown(() => p.input.update(3)).message;
        expect(msg).toContain('Cannot update "input" here');
        expect(msg).toContain("wrap it in an action");
    });

    test('static demand without a lifetime relationship names the resource and the fix', () => {
        let g = new Graph();
        let other = new Player(g);
        other.debugName = "Other";
        other.addToGraphWithAction();
        let p = new Player(g);
        p.behavior().demands(other.seq).supplies(p.countdown).runs(() => {});
        let msg = thrown(() => p.addToGraphWithAction()).message;
        expect(msg).toContain('statically demands "seq" of Other');
        expect(msg).toContain("addChildLifetime");
    });
});
