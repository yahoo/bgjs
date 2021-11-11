//
//  Copyright Yahoo 2021
//


import {
    Graph,
    GraphEvent,
    BehaviorGraphDateProvider,
    Behavior,
    State,
    Moment,
    Resource,
    Extent, InitialEvent
} from '../index';

let g: Graph;
let setupExt: Extent;
let ext: Extent;
let r_a: State<number>;
let r_b: State<number>;
let r_c: State<number>;
beforeEach(() => {
    g = new Graph();
    setupExt = new Extent(g)
    r_a = setupExt.state<number>(0, 'r_a');
    r_b = setupExt.state<number>(0, 'r_b');
    r_c = setupExt.state<number>(0, 'r_c');
    setupExt.addToGraphWithAction();
    ext = new Extent(g);
});

describe('State Resource', () => {

    let g: Graph;
    let ext: Extent;

    beforeEach(() => {
        g = new Graph();
        ext = new Extent(g);
    });

    test('initial state', () => {
        // |> When we create a new state resource
        let sr1 = ext.state<number>(1, 'sr1');

        // |> It has an initial value
        expect(sr1.value).toBe(1);
    });
    // |> It will have that value and event

    test('updates', () => {
        // |> Given a state in the graph
        let sr1 = ext.state<number>(1, 'sr1');
        ext.addToGraphWithAction();

        // |> When it is updated
        sr1.updateWithAction(2);

        expect(sr1.value).toBe(2);
        expect(sr1.event).toBe(g.lastEvent);
    });

    test('filters duplicates', () => {
        // |> Given a state in the graph
        let sr1 = ext.state<number>(1, 'sr1');
        ext.addToGraphWithAction();

        // |> When updated with same value and filtering on
        let entered = sr1.event;
        sr1.updateWithAction(1);

        // |> Then update doesn't happen
        expect(sr1.event).not.toBe(g.lastEvent);
        expect(sr1.event).toBe(entered);
    });

    test('can override duplicate filter', () => {
        // |> Given a state in the graph
        let sr1 = ext.state<number>(1, 'sr1');
        ext.addToGraphWithAction();

        // |> When updated with same value and filtering off
        let entered = sr1.event;
        g.action(null, () => {
            sr1.updateForce(1);
        })

        // |> Then update does happen
        expect(sr1.event).toBe(g.lastEvent);
    });

    test('can be a nullable state', () => {
        // Motivation: nullable states are useful for modeling false/true with data

        // |> Given a nullable state
        let sr1 = ext.state<number | null>(null, 'sr1');
        ext.addToGraphWithAction();

        // |> When updated
        sr1.updateWithAction(1);

        // |> Then it will have that new state
        expect(sr1.value).toBe(1);

        // |> And updated to null
        sr1.updateWithAction(null);

        // |> Then it will have null state
        expect(sr1.value).toBeNull();
    });

    test('works in pushEvent', () => {
        // |> Given a state
        let sr1 = ext.state<number>(0, 'sr1');
        ext.addToGraphWithAction();

        // |> When updated in push event
        ext.action('update', () => {
            sr1.update(1);
        });

        // |> Then state is updated
        expect(sr1.value).toBe(1);
    });

    test('works as demand and supply', () => {
        // |> Given state resources and behaviors
        let sr1 = ext.state<number>(0, 'sr1');
        let sr2 = ext.state<number>(0, 'sr2');
        let ran = false;
        ext.behavior([sr1], [sr2], (extent) => {
            sr2.update(1);
        });
        ext.behavior([sr2], null, (extent) => {
            ran = true;
        });
        ext.addToGraphWithAction();

        // |> When event is started
        sr1.updateWithAction(1);

        // |> Then subsequent behaviors are run
        expect(ran).toBeTruthy();
    });

    test('justChanged', () => {
        // |> Given a state resource
        let sr1 = ext.state<number>(0, 'sr1');
        let changed = false;
        let changedTo = false;
        let changedFrom = false;
        let changedToFrom = false;
        ext.behavior([sr1], null, (extent) => {
            changed = sr1.justUpdated;
            changedTo = sr1.justUpdatedTo(1);
            changedFrom = sr1.justUpdatedFrom(0);
            changedToFrom = sr1.justUpdatedToFrom(1, 0);
        });
        ext.addToGraphWithAction();

        // |> When it updates
        sr1.updateWithAction(1);

        // |> Then its justChangedMethods work
        expect(changed).toBeTruthy();
        expect(changedTo).toBeTruthy();
        expect(changedFrom).toBeTruthy();
        expect(changedToFrom).toBeTruthy();

        // and they dont work outside an event
        expect(sr1.justUpdated).toBeFalsy();
    });

    test('trace tracks before and after values', () => {
        // |> Given a behavior that updates a value
        let sr1 = ext.state<number>(0, 'sr1');
        let mr1 = ext.moment('mr1');
        let before: number | null = null;
        let after: number | null = null;
        let afterEntered: GraphEvent | null = null;
        ext.behavior([mr1], [sr1], (extent) => {
            before = sr1.traceValue;
            sr1.update(1);
            after = sr1.traceValue;
            afterEntered = sr1.traceEvent;
        });
        let beforeEvent = sr1.event;
        ext.addToGraphWithAction();

        // |> When trace is accessed before the update
        mr1.updateWithAction();

        // |> Then that value is the current value
        expect(before).toBe(0);
        expect(sr1.value).toBe(1);
        expect(after).toBe(0);
        expect(afterEntered).toBe(beforeEvent);
    });

    test('trace is value from start of event, not previous value', () => {
        // |> Given a state resource in the graph
        let sr1 = ext.state<number>(0);
        ext.addToGraphWithAction();

        // |> When it is updated multiple times in action (or behavior)
        var traceValue;
        var traceEvent;
        g.action(null, () => {
            sr1.update(1);
            sr1.update(2);
            g.sideEffect(ext, null, (extent) => {
                traceValue = sr1.traceValue;
                traceEvent = sr1.traceEvent;
            });
        });

        // |> Then trace is still the value from beginning of
        expect(traceValue).toBe(0);
        expect(traceEvent).toBe(InitialEvent);
    });

    test('start state is transient after updates', () => {
        // |> Given a state resource
        let sr1 = ext.state<number>(0, 'sr1');
        let mr1 = ext.moment('mr1');
        ext.behavior([mr1], [sr1], (extent) => {
            sr1.update(1);
        });
        ext.addToGraphWithAction();

        // |> When it is updated
        let beforeEvent = g.lastEvent;
        mr1.updateWithAction();

        // |> Then the start state is no longer available after the event
        expect(sr1["previousState"]).toBeNull();
    });

    test('can update state for non-supplied resource when adding', () => {
        let sr1 = ext.state<number>(0, 'sr1');
        let didRun = false;
        ext.behavior([sr1], null, extent => {
            didRun = true;
        });

        g.action('adding', () => {
            sr1.update(1);
            ext.addToGraph();
        });

        expect(didRun).toBeTruthy();
    });

    describe('Checks', () => {

        test('check update state needs state resource to be part of graph', () => {
            // |> Given a state resource not part of the graph
            let sr1 = ext.state<number>(0, 'sr1');

            // |> When it is updated
            // |> Then an error is raised
            expect(() => {
                sr1.update(1);
            }).toThrow();
        });

        test('check supplied state is updated by supplier', () => {
            // |> Given a supplied state resource
            let sr1 = ext.state<number>(0, 'sr1');
            let mr1 = new Moment(ext, 'mr1');
            ext.behavior([mr1], [sr1], extent => {
            });
            ext.behavior([mr1], null, extent => {
                sr1.update(1);
            });
            ext.addToGraphWithAction();

            // |> When it is updated by the wrong behavior
            // |> Then it should throw
            expect(() => {
                mr1.update();
            }).toThrow();
        });

        test('check measured state is update by push event', () => {
            // |> Given a state resource that is not supplied
            let sr1 = ext.state<number>(0, 'sr1');
            let mr1 = new Moment(ext, 'mr1');
            ext.behavior([mr1], null, extent => {
                sr1.update(1);
            });
            ext.addToGraphWithAction();

            // |> When it is updated by a behavior
            // |> Then it should throw
            expect(() => {
                mr1.update();
            }).toThrow();
        });

        test('check update outside event is an error', () => {
            let sr1 = ext.state<number>(0, 'mr1');
            ext.addToGraphWithAction();
            expect(() => {
                sr1.update(2);
            }).toThrow();
        });

        test('update when supplied by another behavior is an error', () => {
            let sr1 = ext.state<number>(0, 'sr1');
            let mr1 = new Moment(ext, 'mr1');
            ext.behavior([mr1], null, extent => {
                sr1.update(2)
            });
            ext.behavior(null, [sr1], extent => {
                sr1.update(3);
            });
            ext.addToGraphWithAction();

            expect(() => {
                mr1.updateWithAction();
            }).toThrow();
        });

        test('unsupplied resource throws if not from action', () => {
            let sr1 = ext.state<number>(0, 'sr1');
            let mr1 = new Moment(ext, 'mr1');
            ext.behavior([mr1], null, extent => {
                sr1.update(2)
            });
            ext.addToGraphWithAction()

            expect(() => {
                mr1.updateWithAction();
            }).toThrow();

        });
    });
})
;

describe('Moment Resource', () => {

    test('moment happens', () => {
        // |> Given a moment in the graph
        let mr1 = new Moment(ext, 'mr1');
        let afterUpdate = false;
        ext.behavior([mr1], null, (extent) => {
            afterUpdate = true;
        });
        ext.addToGraphWithAction();

        // |> When it is read in the graph (and was not updated)
        let beforeUpdate = false;
        let happenedEvent = null;
        ext.action('initial', () => {
            beforeUpdate = mr1.justUpdated;
            mr1.update();
            happenedEvent = ext.graph.currentEvent;
        });

        // |> Then it didn't happen
        expect(beforeUpdate).toBeFalsy();

        // |> And when it updates
        // |> Then it did
        expect(afterUpdate).toBeTruthy();

        // |> And outside an event
        // |> It does not happen
        expect(mr1.justUpdated).toBeFalsy();

        // |> And event stays the same from when it last happened
        expect(mr1.event).toEqual(happenedEvent);
    });

    test('can have data', () => {
        // Given a moment with data
        let mr1 = new Moment<number>(ext, 'mr1');
        let afterUpdate: unknown;
        ext.behavior([mr1], null, (extent) => {
            afterUpdate = mr1.value;
        });
        ext.addToGraphWithAction();

        // |> When it happens
        mr1.updateWithAction(1);

        // |> Then the data is visible in subsequent behaviors
        expect(afterUpdate).toBe(1);

        // but is transient outside event
        expect(mr1.value).toBeUndefined();
    });

    test('non-supplied moment can happen when adding', () => {
        let mr1 = ext.moment('mr1');
        let didRun = false;
        ext.behavior([mr1], null, extent => {
            didRun = true;
        });

        g.action('adding', () => {
            mr1.update();
            ext.addToGraph();
        });

        expect(didRun).toBeTruthy();
    });

    describe('Checks', () => {

        test('check happen requires graph', () => {
            // |> Given a moment resource not part of the graph
            let mr1 = ext.moment('mr1');

            // |> When it is updated
            // |> Then an error is raised
            expect(() => {
                mr1.update();
            }).toThrow();
        });

        test('check supplied moment catches wrong updater', () => {
            // |> Given a supplied state resource
            let mr1 = ext.moment('mr1');
            let mr2 = ext.moment('mr2');
            ext.behavior([mr1], [mr2], extent => {
            });
            ext.behavior([mr1], null, extent => {
                mr2.update();
            });
            ext.addToGraphWithAction();

            // |> When it is updated by the wrong behavior
            // |> Then it should throw
            expect(() => {
                mr1.update();
            }).toThrow();
        });

        test('check measured moment catches wrong updater', () => {
            // |> Given a measured moment resource
            let mr1 = ext.moment('mr1');
            let mr2 = ext.moment('mr2');
            ext.behavior([mr1], null, extent => {
            });
            ext.behavior([mr1], null, extent => {
                mr2.update();
            });
            ext.addToGraphWithAction();

            // |> When it is updated by the wrong behavior
            // |> Then it should throw
            expect(() => {
                mr1.update();
            }).toThrow();
        });

        test('check moment happens outside event is an error', () => {
            let mr1 = ext.moment('mr1');
            ext.addToGraphWithAction();
            expect(() => {
                mr1.update();
            }).toThrow();
        });

    });
});

describe('dependencies', () => {

    test('a activates b', () => {
        ext.behavior([r_a], [r_b], extent => {
            r_b.update(2 * r_a.value);
        });
        ext.addToGraphWithAction();
        r_a.updateWithAction(1);

        expect(r_b.value).toBe(2);
        expect(r_a.event).toBe(r_b.event);
    });

    test('behavior activated once per event', () => {
        let called = 0;
        ext.behavior([r_a, r_b], [r_c], extent => {
            called += 1;
        });

        ext.addToGraphWithAction();

        g.action('test', () => {
            r_a.update(1);
            r_b.update(2);
        });

        expect(called).toBe(1);
    });

    test('duplicates are filtered out', () => {
        let b1 = ext.behavior([r_a, r_a], [r_b, r_b], extent => {
        });
        ext.addToGraphWithAction();

        expect(b1.demands!.size).toBe(1);
        expect(b1.supplies!.size).toBe(1);
        expect(r_a.subsequents!.size).toBe(1);
    });

    test('check can update resource in a different extent', () => {

        let parentExt = new Extent(g)
        let ext2 = new Extent(g);

        let parent_r = parentExt.state<number>(0, 'parent_r');
        let parent_r2 = parentExt.state<number>(0, 'parent_r2');

        let ext2_r1 = ext2.state<number>(0, 'ext2_r1');

        parentExt.behavior([parent_r], [parent_r2], (extent: Extent) => {
            //never invoked:-(
            parent_r2.update(parent_r.value)
        });

        ext2.behavior([ext2_r1], [parent_r], (extent: Extent) => {
            parent_r.update(ext2_r1.value)
        });

        ext2.addToGraphWithAction();
        parentExt.addToGraphWithAction()

        g.action('update ext2_r1', () => {
            ext2_r1.update(33)
        });

        expect(parent_r2.value).toBe(33)
    });

});


describe('dynamic graph changes', () => {

    test('can add and update in the same event', () => {
        let r_x: State<number> = ext.state(0, 'r_x');
        ext.behavior([r_a], [r_x], extent => {
            r_x.update(r_a.value * 2);
        });

        g.action('add', () => {
            r_a.update(2);
            ext.addToGraph();
        });

        expect(r_x.value).toBe(4);
    });

    test('behavior can add extent', () => {
        // given a behavior that adds a new extent when something happens

        // -- this is new behavior that does the work
        let ext2 = new Extent(g);
        ext2.behavior([r_b], [r_c], (extent: Extent) => {
            if (r_b.event != null) {
                r_c.update(r_b.value + 1);
            }
        });

        // -- this behavior adds the new extent on event happening
        ext.behavior([r_a], null, (extent: Extent) => {
            g.addExtent(ext2);
        });
        ext.addToGraphWithAction();

        expect(r_c.event.sequence).toEqual(0);

        // when that something happens
        r_a.updateWithAction(1);

        // then that new extent should be added
        r_b.updateWithAction(2);

        expect(r_c.value).toBe(3);
    });

    test('activated behaviors can reorder if demands change', () => {
        let counter = 0;
        let whenX = 0;
        let whenY = 0;

        // create two behaviors such that a comes before b and they both come after a reordering step
        // each one keeps track of when it ran relative to the other
        let reordering: State<null> = ext.state(null, 'reordering');
        let x_out = ext.state(0, 'x_out');
        let x_bhv = ext.behavior([r_a, reordering], [x_out], (extent: Extent) => {
            whenX = counter;
            counter = counter + 1;
        });
        let y_out = ext.state(0, 'y_out');
        let y_bhv = ext.behavior([r_a, reordering, x_out], [y_out], (extent: Extent) => {
            whenY = counter;
            counter = counter + 1;
        });

        ext.behavior([r_a], [reordering], (extent: Extent) => {
            x_bhv.setDemands([r_a, reordering, y_out]);
            y_bhv.setDemands([r_a, reordering]);
        });

        ext.addToGraphWithAction();

        // when event that activates re-demand behavior happens
        r_a.updateWithAction(2);

        // X should be 3 and Y should be 2 (they are 0 and 1 when they get added)
        expect(whenX).toBeGreaterThan(whenY);
    });

    test('removed extents remove components from graph', () => {
        // given an added behavior

        let r_x = ext.state(0, 'r_x');
        let b_a = ext.behavior([r_a], [r_b], extent => {
            r_b.update(r_a.value + 1);
        });
        ext.addToGraphWithAction();

        // when its extent is removed and its previous demand is updated
        ext.removeFromGraphWithAction();
        r_a.updateWithAction(1);

        // then it should not get run
        expect(r_b.value).toEqual(0);

        // and be removed
        expect(b_a.added).toBeFalsy();
        expect(r_x.added).toBeFalsy();
        expect(ext.addedToGraphWhen).toBeNull();
    });

    test('removed resources are removed from foreign demands', () => {
        // |> Given we have a resource that is demanded both inside and outside extent
        let ext2 = new Extent(g);
        let demanded1 = ext2.moment('demanded1');
        let ext1behavior = ext.behavior([demanded1], null, extent => {
        });
        let ext2behavior = ext2.behavior([demanded1], null, extent => {
        });
        g.action("adding", () => {
            ext.addToGraph();
            ext2.addToGraph();
        });

        // |> When the extent that owns that resource is removed
        ext2.removeFromGraphWithAction();

        // |> Then it will no longer be demanded by the foreign behavior
        expect(ext1behavior.demands!.size).toEqual(0);
        // but it will be left wired in the local behavior (for performance)
        expect(ext2behavior.demands!.size).toEqual(1);
        // and subsequents are all removed (for performance since its faster to remove all than just foreign)
        expect(demanded1.subsequents.size).toEqual(0);
    });

    test('removed resources are removed from foreign supplies', () => {
        // |> Given we have resources that are supplied both inside and outside extent
        let ext2 = new Extent(g);
        let supplied1 = ext2.moment('supplied1');
        let supplied2 = ext2.moment('supplied2');
        let ext1behavior = ext.behavior(null, [supplied1], extent => {
        });
        let ext2behavior = ext2.behavior(null, [supplied2], extent => {
        });
        g.action("adding", () => {
            ext.addToGraph();
            ext2.addToGraph();
        });

        // |> When the extent that owns those resources is removed
        ext2.removeFromGraphWithAction();

        // |> Then one will no longer be supplied by the foreign behavior
        expect(ext1behavior.supplies!.size).toEqual(0);
        expect(supplied1.suppliedBy).toBeNull();
        // but it will be left wired in the local behavior (for performance)
        expect(ext2behavior.supplies!.size).toEqual(1);
    });

    test('removed behaviors are removed from foreign subsequents', () => {
        // |> Given we have a behavior which has foreign and local demands
        let ext2 = new Extent(g);
        let demanded1 = ext.moment('demanded1');
        let demanded2 = ext2.moment('demanded2');
        let ext2behavior = ext2.behavior([demanded1, demanded2], null, extent => {
        });
        g.action('adding', () => {
            ext.addToGraph();
            ext2.addToGraph();
        });

        // |> When its owning extent is removed
        ext2.removeFromGraphWithAction();

        // |> Then the foreign demand will have this behavior removed as a subsequent
        expect(demanded1.subsequents.size).toEqual(0);
        // But the local demand won't remove it (for performance)
        expect(demanded2.subsequents.size).toEqual(1);
        // |> And all demands will be removed
        expect(ext2behavior.demands!.size).toEqual(0);
    });

    test('removed behaviors are removed as foreign suppliers', () => {
        // |> Given we have a behavior which supplies both foreign and local resources
        let ext2 = new Extent(g);
        let supplied1 = ext.moment('supplied1');
        let supplied2 = ext2.moment('supplied2');
        let ext2behavior = ext2.behavior(null, [supplied1, supplied2], extent => {
        });
        g.action('adding', () => {
            ext.addToGraph();
            ext2.addToGraph();
        });

        // |> When its owning extent is removed
        ext2.removeFromGraphWithAction();

        // |> Then the foreign supply will have this behavior removed as a supplied by
        expect(supplied1.suppliedBy).toBeNull();
        // |> But the local supply won't remove it
        expect(supplied2.suppliedBy).not.toBeNull();
        // |> And all supplies will be removed from behavior
        expect(ext2behavior.supplies!.size).toEqual(0);
    });

    test('activated then removed behaviors dont run', () => {
        // given a behavior that is added
        let remover = ext.state(null, 'y_out');

        let ext2: Extent = new Extent(g);
        let didRun: State<boolean> = ext2.state(false, 'didRun');
        ext2.behavior([r_a, remover], [didRun], extent => {
            if (r_a.justUpdated) {
                didRun.update(true);
            }
        });
        ext.behavior([r_a], [remover], extent => {
            ext2.removeFromGraph();
        });

        g.action('add', () => {
            ext.addToGraphWithAction();
            ext2.addToGraphWithAction();
        });

        // when it is both activated and removed in the same event
        r_a.updateWithAction(1);

        // then it will not run
        expect(didRun.value).toBeFalsy();
    });

    test('can supply a resource by a behavior in a different extent after its subsequent is added', () => {
        // ext has resource a and process that depends on it and then it is added
        let r_z: State<number> = ext.state(0, 'r_z');
        let r_y: State<number> = ext.state(0, 'r_y');
        ext.behavior([r_y], [r_z], extent => {
            r_z.update(r_y.value);
        });
        ext.addToGraphWithAction();

        // then a new extent is added that supplies it by a new behavior, it could just pass along the value
        let ext2: Extent = new Extent(g);
        let r_x: State<number> = ext2.state(0, 'r_x');
        ext2.behavior([r_x], [r_y], extent => {
            r_y.update(r_x.value);
        });
        ext2.addToGraphWithAction();

        // then update the trigger which should pass it along to the end
        r_x.updateWithAction(1);
        expect(r_z.value).toBe(1);
    });

    test('updating post-add demands changes them', () => {
        let b1 = ext.behavior([], [], extent => {
        });
        ext.addToGraphWithAction();

        g.action('update', () => {
            b1.setDemands([r_a]);
        });

        expect(b1.demands).toContain(r_a);
    });

    test('changing to a demand a resource that has already been updated this event will activate behavior', () => {
        // |> Given we have a behavior that doesn't demand r_a
        let run = false;
        let b1 = ext.behavior([], [], extent => {
            run = true;
        });
        ext.behavior([r_a], [], extent => {
            b1.setDemands([r_a]);
        });
        ext.addToGraphWithAction();

        // |> When we update the behavior to demand r_a in the same event that r_a has already run
        r_a.updateWithAction(1);

        // |> Then our behavior will activate
        expect(run).toBeTruthy();
    });

    test('updating post-add supplies changes them', () => {
        let b1 = ext.behavior([], [], extent => {
        });
        ext.addToGraphWithAction();

        g.action('update', () => {
            b1.setSupplies([r_a]);
        });

        expect(b1.supplies).toContain(r_a);
    });

    test('adding a post-add supply will reorder activated behaviors', () => {

        // first add a behavior that demands an unsupplied resource
        let r_y: State<number> = ext.state(0, 'r_y');
        let r_x: State<number> = ext.state(0, 'r_x');
        ext.behavior([r_a, r_x], [r_y], extent => {
            if (r_x.justUpdated) {
                r_y.update(r_a.value);
            }
        });
        ext.addToGraphWithAction();

        // then add another behavior that (will) supply the resource
        // b_a behavior should be reordered to come after b_b
        let ext2: Extent = new Extent(g);
        let b_b = ext2.behavior([r_a], null, extent => {
            r_x.update(r_a.value);
        });
        ext2.addToGraphWithAction();

        // update the supply to accommodate
        g.action('supply r_x', () => {
            b_b.setSupplies([r_x]);
        });

        // when action initiates updates we should get them run in order
        r_a.updateWithAction(3);

        // if they don't get reordered then b_a will still run first since
        // both demand r_a which gets run. And that would be wrong because
        // b_a now is subsequent to b_b
        expect(r_y.value).toBe(3);
    });

    test('changing supplies will unsupply old resources', () => {
        // |> Given we have a resource supplied by a behavior
        let m1 = new Moment(ext);
        ext.behavior(null, [m1], (extent) => {
            // do nothing
        });
        ext.addToGraphWithAction();

        // |> When that behavior no longer supplies that original resource
        ext.action("change supply", () => {
            m1.suppliedBy!.setSupplies([]);
        });

        // |> Then that resource should free to be supplied by another behavior
        expect(m1.suppliedBy).toBeNull();
    });

});

describe('Extents', () => {

    class TestExtent extends Extent {
        r1: State<number>;
        r2: State<number>;
        b1: Behavior;

        constructor(graph: Graph) {
            super(graph);
            this.r1 = this.state(0, 'r1');
            this.r2 = this.state(0, 'custom_r2');
            this.b1 = new Behavior(this, [this.r1], [this.r2], (extent: Extent) => {
                if (this.r1.justUpdated) {
                    this.r2.update(this.r1.value * 2);
                }
            });
        }

        injectNumber(num: number) {
            this.r1.updateWithAction(num);
        }
    }

    test('gets class name', () => {
        let e = new TestExtent(g);
        expect(e.debugName).toBe('TestExtent');
    });

    test('contained components picked up', () => {
        let e = new TestExtent(g);
        e.addToGraphWithAction();

        expect(e.r1.graph).toBe(g);
        expect(e.r1.added).toBeTruthy();
        expect(e.b1.extent).toBe(e);
        expect(e.b1.added).toBeTruthy();
        expect(e.r2.value).toEqual(0);

        e.injectNumber(2);
        expect(e.r1.value).toBe(2);
        expect(e.r2.value).toBe(4);
    });

    test('contained components named if needed', () => {
        let e = new TestExtent(g);
        e.addToGraphWithAction();

        // property names
        expect(e.r1.debugName).toBe('r1');
        // custom name not overridden
        expect(e.r2.debugName).toBe('custom_r2');
    });

    test('added resource is updated on adding', () => {
        let e = new Extent(g);
        let runOnAdd = false;
        e.behavior([e.addedToGraph], [], extent => {
            runOnAdd = true;
        });
        e.addToGraphWithAction();

        expect(runOnAdd).toBeTruthy();
    });

    describe('Checks', () => {

        test('check cannot add extent to graph multiple times', () => {
            expect(() => {
                setupExt.addToGraphWithAction();
            }).toThrow();
        });

        test('check actions on unadded extents are errors', () => {
            let e = new TestExtent(g);
            expect(() => {
                e.action('impulse1', () => {
                });
            }).toThrow();
            expect(() => {
                e.actionAsync('impulse2', () => {
                });
            }).toThrow();
        });

        test('check extent cannot be added to graph outside event', () => {
            let e = new TestExtent(g);
            expect(() => {
                e.addToGraph();
            }).toThrow();
        });

        test('check extent cannot be removed from graph outside event', () => {
            let e = new TestExtent(g);
            e.addToGraphWithAction();
            expect(() => {
                e.removeFromGraph();
            }).toThrow();
        });
    });
})
;

describe('Graph checks', () => {

    test('check cannot add extent to graph outside event', () => {
        expect(() => {
            g.addExtent(ext);
        }).toThrow();
    });

    test('check cannot remove extent from graph outside event', () => {
        ext.addToGraphWithAction();
        expect(() => {
            g.removeExtent(ext);
        }).toThrow();
    })

    test('check no graph dependency cycles', () => {
        let r_x = ext.state(0, 'r_x');
        let r_y = ext.state(0, 'r_y');
        let r_z = ext.state(0, 'r_z');
        ext.behavior(null, [r_z], extent => {
            // non cycle behavior
        });
        ext.behavior([r_z, r_y], [r_x], extent => {
        });
        ext.behavior([r_x], [r_y], extent => {
        });

        let caught = false;
        try {
            ext.addToGraphWithAction();
        } catch (err) {
            caught = true;
            let cycle: Resource[] = err.cycle;
            expect(cycle).toHaveLength(2);
            expect(cycle[0]).toEqual(r_x);
            expect(cycle[1]).toEqual(r_y);
        }
        expect(caught).toBeTruthy();
    });


    test('check resource can only be supplied by one behavior', () => {
        let r_x = ext.state(0, 'r_x');
        ext.behavior([r_a], [r_x], extent => {
        });
        ext.behavior([r_a], [r_x], extent => {
        });
        expect(() => {
            ext.addToGraphWithAction();
        }).toThrow();
    });

    test('check update demands and supplies only during event', () => {
        let b_x = ext.behavior([], [], extent => {
        });
        ext.addToGraphWithAction();

        expect(() => {
            b_x.setDemands([r_a]);
        }).toThrow();

        expect(() => {
            b_x.setSupplies([r_b]);
        }).toThrow();
    });

    test('check can\'t update demands or supplies on behavior not in graph', () => {
        let b_x = ext.behavior([], [], extent => {
        });

        expect(() => {
            g.action('update', () => {
                b_x.setDemands([r_a]);
            });
        }).toThrow();

        expect(() => {
            g.action('update', () => {
                b_x.setSupplies([r_a]);
            });
        }).toThrow();

    });

    test('handled errors cancel any pending actions/effects but ready to run more', () => {
        // |> Given a event with an error that is handled
        let innerAction = false;
        let innerEffect = false;
        let secondAction = false;
        ext.addToGraphWithAction();
        expect(() => {
            g.action('throws', () => {
                ext.sideEffect('action', (extent) => {
                    g.action('innerAction', () => {
                        innerAction = true;
                    });
                })
                ext.sideEffect('innerEffect', (extent) => {
                    throw(new Error());
                });
                ext.sideEffect('effect', (extent) => {
                    innerEffect = true;
                });
            });
        }).toThrow();

        // |> When trying to run another event
        g.action('works', () => {
            secondAction = true;
        });

        // |> Then the next should work
        expect(innerAction).toBe(false);
        expect(innerEffect).toBe(false);
        expect(secondAction).toBe(true);

    });

    test('handled throw in behavior should clear out queued up internals', () => {
        let r1 = ext.moment('r1');
        let r2 = ext.moment('r2');
        let r3 = ext.moment('r3');
        let b3: Behavior;

        ext.behavior([r1], [r2], extent => {
            r2.update();
        });
        ext.behavior([r2], [r3], extent => {
            r3.update();
            b3.setDemands([]);
            b3.setSupplies([]);
            throw(new Error());
        });
        b3 = ext.behavior([r3], null, extent => {
            // do nothing
        });
        ext.addToGraphWithAction();
        expect(() => {
            g.action('r1', () => {
                r1.update();
            });
        }).toThrow();

        expect(g.currentEvent).toBeNull();
        expect(g.currentBehavior).toBeNull();
        expect(g.activatedBehaviors).toHaveLength(0);
        expect(r1.justUpdated).toBeFalsy();
        expect(g.modifiedSupplyBehaviors).toHaveLength(0);
        expect(g.modifiedDemandBehaviors).toHaveLength(0);
    });

    test('handled error when adding extent doesn\'t leave dangling behaviors', () => {
        // |> Given we are adding an extent
        ext.behavior(null, null, extent => {
            // do nothing
        });

        // |> When it throws when adding
        expect(() => {
            g.action('add', () => {
                ext.addToGraph();
                throw(new Error());
            });
        }).toThrow();

        // |> Then behaviors from that extent aren't waiting to be added
        expect(g.untrackedBehaviors).toHaveLength(0);
    });

    test('check cannot demand a resource from an extent that has not been added to graph', () => {
        let ext3 = new Extent(g);
        let mr1 = ext3.moment('mr1');
        ext.behavior([mr1], null, (extent) => {
            // do nothing
        });
        expect(() => {
            ext.addToGraphWithAction();
        }).toThrow();
    });
});

describe('Effects, Actions, Events', () => {

    test('happen after all behaviors', () => {

        let happened: boolean = false;
        // behavior a has a side effect and
        ext.behavior([r_a], [r_b], extent => {
            extent.sideEffect('happen', extent => {
                happened = true;
            });
            r_b.update(1);
        });

        // b depends on a
        // check that side effect didn't happen during b's run
        ext.behavior([r_b], null, extent => {
            expect(happened).toBeFalsy();
            extent.sideEffect('after effect', (extent) => {
                expect(happened).toBeTruthy();
            });
        });

        ext.addToGraphWithAction();
        r_a.updateWithAction(1);

        // expectations happen inside behavior
    });


    test('execute in the order they are pushed', () => {
        let counter: number = 0;
        let whenX: number = 0;
        let whenY: number = 0;
        ext.behavior([r_a], [r_b], extent => {
            ext.sideEffect('first', (extent) => {
                whenX = counter;
                counter += 1;
            });
            r_b.update(1);
        });
        ext.behavior([r_b], null, extent => {
            ext.sideEffect('second', (extent) => {
                whenY = counter;
                counter += 1;
            });
        });

        ext.addToGraphWithAction();
        r_a.updateWithAction(1);

        expect(whenY).toBeGreaterThan(whenX);
    });

    test('transient values are cleared after effects are run', () => {
        let r1 = ext.moment('r1');
        ext.behavior([r_a], [r1], extent => {
            r1.update();
            extent.sideEffect('after', (extent) => {
                expect(r_a.justUpdatedTo(1)).toBeTruthy();
                expect(r1.justUpdated).toBeTruthy();
            });
        });
        ext.addToGraphWithAction();
        r_a.updateWithAction(1);

        expect(r_a.justUpdatedTo(1)).toBeFalsy();
        expect(r1.justUpdated).toBeFalsy();
    });

    /*
    Dont know what this one tests
    test('effects are sequenced', () => {
        // |> Given an effect starts another event
        let effectCounter = 0;
        let firstEffect: number | null = null;
        let secondEffect: number | null = null;
        ext.makeBehavior([r_a], null, (extent) => {
            if (r_a.justUpdated) {
                extent.sideEffect('update b', (extent) => {
                    ext.action('update b', () => {
                        // initiate another event
                        r_b.update(2)
                    });
                });
                extent.sideEffect('first effect', (extent) => {
                    firstEffect = effectCounter;
                    effectCounter += 1;
                });
            }
        });

        ext.makeBehavior([r_b], null, (extent) => {
            if (r_b.justUpdated) {
                extent.sideEffect('second effect', (extent) => {
                    secondEffect = effectCounter;
                    effectCounter += 1;
                });
            }
        });

        ext.addToGraphWithAction();

        // |> When the side effects run
        r_a.updateWithAction(1);

        // |> Then the side effect from the second event will run
        // after the remaining effects from the first event
        expect(firstEffect).toBe(0);
        expect(secondEffect).toBe(1);
        expect(effectCounter).toBe(2);
    });
    */

    test('effects from first event complete before next event', () => {
        // |> Given event with 2 effects
        let effectCounter = 0;
        let m1 = ext.moment('m1');
        let eventLoopOrder, effect2Order: number | undefined;
        ext.behavior([m1], null, (extent) => {
            extent.sideEffect('effect 1', (extent) => {
                extent.graph.action('event2', () => {
                    eventLoopOrder = effectCounter++;
                });
            });
            extent.sideEffect('effect 2', (extent) => {
                effect2Order = effectCounter++;
            });
        });
        ext.addToGraphWithAction();

        // |> When the first effect initiates a new event
        m1.updateWithAction();

        // |> Then the second effect will run before the new event
        expect(effect2Order).toEqual(0);
        expect(eventLoopOrder).toEqual(1);
    });

    test('behaviors from first event complete before next event', () => {
        // Note: Initiating side effects directly from within a behavior can lead to accessing
        // and thus depending on state without being explicit about that dependency. However
        // it does not mean it is strictly an error. We should be able to synchronously initiate
        // a new event without necessarily breaking the graph.

        // |> Given we are in the middle of an event with multiple
        let effectCounter = 0;
        let eventLoopOrder, behavior2Order: number | undefined;
        let m1 = ext.moment('m1');
        let m2 = ext.moment('m2');
        ext.behavior([m1], [m2], (extent) => {
            m2.update();
            extent.action('inside side effect', () => {
                eventLoopOrder = effectCounter++;
            });
        });
        ext.behavior([m2], null, extent => {
            behavior2Order = effectCounter++;
        });
        ext.addToGraphWithAction();

        // |> When an event is initiated from a prior behavior
        m1.updateWithAction();

        // |> Then the subsequent behavior will run before the next event
        expect(behavior2Order).toEqual(0);
        expect(eventLoopOrder).toEqual(1);
    });

    test('check updating a behavior after a side effect should throw', () => {
        // Note: Here again, side effects shouldn't come directly from inside a
        // behavior. So if one does create a new event and there's still
        // more resources to update there we won't be able to do that

        let m1 = ext.moment('m1');
        let m2 = ext.moment('m2');
        ext.behavior([m1], [m2], (extent) => {
            extent.action('inside side effect', () => {
                // this will force event to finish when it runs synchronously
            });
            // event should have finished by the time we return up the stack
            // causing this to fail
            expect(() => {
                m2.update();
            }).toThrow();
        });
        ext.addToGraphWithAction();

        m1.updateWithAction();

    });

    test('actions are run synchronously by default when there is only one', () => {
        // |> Given there are no running events
        let counter = 0;
        ext.addToGraphWithAction();

        // |> When an action is added
        ext.action('action', () => {
            counter = counter + 1;
        });

        // |> Then it will be run synchronously
        expect(counter).toBe(1);
    });

    test('actions are synchronous by default', () => {
        // |> Given there is a running event
        let counter = 1;
        let effectIsRun = 0;
        let actionIsRun = 0;
        ext.addToGraphWithAction();

        // |> When a new action is added
        ext.action('existing', () => {
            ext.sideEffect('side effect', (extent) => {
                ext.action('new', () => {
                    actionIsRun = counter;
                    counter = counter + 1;
                });
                effectIsRun = counter;
                counter = counter + 1;
            });
        });

        // |> Then it will be run after first event completes entirely
        expect(effectIsRun).toBe(2);
        expect(actionIsRun).toBe(1);
    });

    test('actions can opt into async', () => {
        // |> Given there is a running event
        let counter = 1;
        let effectIsRun = 0;
        let actionIsRun = 0;
        ext.addToGraphWithAction();

        // |> When a new action is added asynchronously
        ext.action('existing', () => {
            ext.sideEffect('side effect', (extent) => {
                ext.actionAsync('new', () => {
                    actionIsRun = counter;
                    counter = counter + 1;
                });
                effectIsRun = counter;
                counter = counter + 1;
            });
        });

        // |> Then it will be run after first event completes entirely
        expect(effectIsRun).toBe(1);
        expect(actionIsRun).toBe(2);
    });

    test('actionAsync runs immediately if no current events', () => {
        let effectIsRun = false;
        ext.addToGraphWithAction();
        ext.actionAsync('existing', () => {
            ext.sideEffect('side effect', (extent) => {
                effectIsRun = true;
            });
        });

        expect(effectIsRun).toBeTruthy();
    });

    test('timeProvider gives an alternate time', () => {
        let t = new Date(1);
        let tp = {
            now: () => {
                return t;
            }
        }
        let g2 = new Graph(tp);
        let ext3 = new Extent(g2);
        let r1 = ext3.state<number>(0, 'r1');
        ext3.addToGraphWithAction();
        r1.updateWithAction(1);
        expect(r1.event.timestamp).toEqual(new Date(1));
    });

    test('effects can only be run during an event', () => {
        ext.addToGraphWithAction();
        expect(() => {
            ext.sideEffect('should throw', (extent) => {
                // do nothing
            });
        }).toThrow();
    });
});

