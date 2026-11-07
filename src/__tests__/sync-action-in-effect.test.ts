//
//  Copyright Yahoo 2021
//

// A side effect often calls out to client code (a listener, a UI callback), and that code may
// start an action. Client code expects `action` to be synchronous: when the call returns, the
// work has happened. An API that is sometimes synchronous and sometimes deferred ("releasing
// Zalgo", after Isaac Schlueter's "Designing APIs for Asynchrony") breaks that expectation in
// ways the client cannot see. So a synchronous action started from a side effect first finishes
// the current event's remaining side effects, then runs to completion, then returns.
//
// The cost lands on the side effect that made the call: the rest of its block runs after its
// event has closed. These tests pin that order, check that a failure is reported to the code
// that owns it, and check the warning for code that touches the graph after the nested action.

import {Extent, Graph} from '../index.js';

class Player extends Extent {
    go = this.moment<number>();
    played = this.moment();
    position = this.state(0);
    effectA: (ext: Player) => void = () => {};
    effectB: (ext: Player) => void = () => {};
    effectC: (ext: Player) => void = () => {};
    log: string[] = [];
    failPlay = false;

    constructor(graph: Graph) {
        super(graph);
        this.behavior().demands(this.go).runs(ext => {
            ext.sideEffect(ext => ext.effectA(ext), 'A');
            ext.sideEffect(ext => ext.effectB(ext), 'B');
            ext.sideEffect(ext => ext.effectC(ext), 'C');
        });
        this.behavior().demands(this.played).supplies(this.position).runs(ext => {
            if (ext.failPlay) {
                throw new Error('play failed');
            }
            ext.position.update(ext.position.value + 1);
            ext.sideEffect(ext => ext.log.push(`played effect (event ${ext.graph.currentEvent!.sequence})`), 'played');
        });
    }

    // what client code would call: a synchronous API backed by an action
    play() {
        this.played.updateWithAction();
    }
}

describe('Sync action from a side effect (no Zalgo: the caller sees it completed)', () => {
    let g: Graph;
    let p: Player;
    let warnings: string[];

    beforeEach(() => {
        g = new Graph();
        warnings = [];
        g.onWarning = (message) => warnings.push(message);
        p = new Player(g);
        p.addToGraphWithAction();
    });

    test('remaining side effects of the event run first, then the new event, then the rest of the calling side effect', () => {
        p.effectA = ext => {
            ext.log.push(`A start (event ${g.currentEvent!.sequence})`);
            ext.play();
            ext.log.push(`A resumes (currentEvent ${g.currentEvent?.sequence ?? null})`);
        };
        p.effectB = ext => ext.log.push(`B (event ${g.currentEvent!.sequence}, position ${ext.position.value})`);
        p.effectC = ext => ext.log.push(`C (event ${g.currentEvent!.sequence})`);

        p.go.updateWithAction(1);

        expect(p.log).toEqual([
            'A start (event 2)',
            'B (event 2, position 0)',
            'C (event 2)',
            'played effect (event 3)',
            'A resumes (currentEvent null)',
        ]);
        // the client's call was synchronous: when play() returned, its event had completed
        expect(p.position.value).toBe(1);
    });

    test('an error from the new event reaches the client code that started it', () => {
        let caught: any = null;
        p.failPlay = true;
        p.effectA = ext => {
            try {
                ext.play();
            } catch (e) {
                caught = e;
            }
        };
        p.effectB = ext => ext.log.push('B');

        p.go.updateWithAction(1);

        // B ran before the new event, so the client's error is the client's own
        expect(caught.message).toBe('play failed');
        expect(p.log).toEqual(['B']);
    });

    test('an error from another side effect is not swallowed by the side effect that started an action', () => {
        let caught: any = null;
        let original = new Error('B failed');
        p.effectA = ext => {
            try {
                ext.play();
            } catch (e) {
                caught = e;
            }
        };
        p.effectB = () => {
            throw original;
        };
        p.effectC = ext => ext.log.push('C');

        // the action that opened the event reports B's error, even though A caught something
        expect(() => p.go.updateWithAction(1)).toThrow(original);

        // A's call was told that its action never ran, and why
        expect(caught).not.toBe(original);
        expect(caught.cause).toBe(original);
        expect(caught.message).toContain('never ran');
        expect(caught.message).toContain('"A"');
        expect(caught.message).toContain('B failed');
        // the action never ran, and the rest of the event was discarded
        expect(p.position.value).toBe(0);
        expect(p.log).toEqual([]);

        // the graph is ready for more
        p.play();
        expect(p.position.value).toBe(1);
    });

    test('the original error still reaches the opening action when the calling side effect rethrows', () => {
        let original = new Error('B failed');
        p.effectA = ext => ext.play();
        p.effectB = () => {
            throw original;
        };

        expect(() => p.go.updateWithAction(1)).toThrow(original);
    });

    test('an action as the last statement of a side effect gives no warning', () => {
        p.effectA = ext => {
            ext.log.push(`position ${ext.position.value}`);
            ext.play();
        };

        p.go.updateWithAction(1);

        expect(warnings).toEqual([]);
        expect(p.position.value).toBe(1);
    });

    test('reading the graph after the nested action returns warns once, naming the side effect and events', () => {
        let readAfter: any[] = [];
        p.effectA = ext => {
            ext.play();
            readAfter.push(ext.go.value, ext.go.justUpdated, ext.position.value);
        };

        p.go.updateWithAction(1);

        // these reads answer for a closed event
        expect(readAfter).toEqual([undefined, false, 1]);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('"A"');
        expect(warnings[0]).toContain('Player');
        expect(warnings[0]).toContain('event 2');
        expect(warnings[0]).toContain('"go"');
        expect(warnings[0]).toContain('outside any event');
    });

    test('starting another action after the nested action returns warns', () => {
        p.effectA = ext => {
            ext.play();
            ext.play();
        };

        p.go.updateWithAction(1);

        expect(p.position.value).toBe(2);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('started another action');
    });

    test('queuing a side effect after the nested action returns throws, saying why', () => {
        let caught: any = null;
        p.effectA = ext => {
            ext.play();
            try {
                ext.sideEffect(() => {});
            } catch (e) {
                caught = e;
            }
        };

        p.go.updateWithAction(1);

        expect(caught.message).toContain('Cannot queue a side effect');
        expect(caught.message).toContain('"A"');
        expect(caught.message).toContain('event 2');
    });

    test('code outside any side effect does not warn', () => {
        p.play();
        p.position.value;
        p.go.justUpdated;
        expect(warnings).toEqual([]);
    });
});
