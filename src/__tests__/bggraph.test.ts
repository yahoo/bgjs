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
        g.action(() => {
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
        ext.action(() => {
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
        g.action(() => {
            sr1.update(1);
            sr1.update(2);
            g.sideEffect(() => {
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

        g.action(() => {
            sr1.update(1);
            ext.addToGraph();
        });

        expect(didRun).toBeTruthy();
    });

    describe('Checks', () => {

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
                mr1.updateWithAction();
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
                mr1.updateWithAction();
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
                mr1.update();
            }).toThrow();

        });

        test('cannot access value inside behavior if not supply or demand', () => {
            let sr1 = ext.state(1);
            let sr2 = ext.state(1);
            let sr3 = ext.state(1);
            let sr4 = ext.state(1);
            let sr5 = ext.state(1);

            // |> Given resource that are supplied and demanded
            ext.behavior([sr1], [sr2], ext => {
                sr1.value;
                sr1.event;
                sr1.justUpdated;
                sr2.value;
                sr2.event;
                sr2.justUpdated;
            });
            ext.addToGraphWithAction();

            // |> When they are accessed inside a behavior during an event
            // |> Then it will succeed
            sr1.updateWithAction(2);

            // |> And when they are accessed outside an event or behavior
            // |> Then it will succeed
            sr1.value;
            sr1.event;
            sr1.justUpdated;

            // |> And when we access a non-supplied resource inside an action
            // |> Then it will succeed
            g.action(() => {
                sr1.value;
            });

            // |> But Given behaviors that access value, event, or justUpdated for a resource
            // that is not supplied or demanded
            let ext2 = new Extent(g);
            ext2.behavior([sr3], null, ext => {
                sr2.value;
            });

            ext2.behavior([sr4], null, ext => {
                sr2.event;
            });

            ext2.behavior([sr5], null, ext => {
                sr2.justUpdated;
            });
            ext2.addToGraphWithAction();

            // |> Then it will fail
            expect(() => {
                sr3.updateWithAction(2);
            }).toThrow();

            expect(() => {
                sr4.updateWithAction(2);
            }).toThrow();

            expect(() => {
                sr5.updateWithAction(2);
            }).toThrow();

            // |> And when we access a supplied resource from an action
            // |> Then it will fail
            expect(() => {
                sr2.updateWithAction(2);
            }).toThrow();
        });
    });
});

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
        ext.action(() => {
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
        let updatedToOne = false;
        ext.behavior([mr1], null, (extent) => {
            afterUpdate = mr1.value;
            updatedToOne = mr1.justUpdatedTo(1);
        });
        ext.addToGraphWithAction();

        // |> When it happens
        mr1.updateWithAction(1);

        // |> Then the data is visible in subsequent behaviors
        expect(afterUpdate).toBe(1);
        expect(updatedToOne).toBeTruthy();
        
        // but is transient outside event
        expect(mr1.value).toBeUndefined();
    });

    test('non-supplied moment can happen when adding', () => {
        let mr1 = ext.moment('mr1');
        let didRun = false;
        ext.behavior([mr1], null, extent => {
            didRun = true;
        });

        g.action(() => {
            mr1.update();
            ext.addToGraph();
        });

        expect(didRun).toBeTruthy();
    });

    describe('Checks', () => {

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
                mr1.updateWithAction();
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
                mr1.updateWithAction();
            }).toThrow();
        });

        test('check moment happens outside event is an error', () => {
            let mr1 = ext.moment('mr1');
            ext.addToGraphWithAction();
            expect(() => {
                mr1.update();
            }).toThrow();
        });

        test('cannot access value inside behavior if not supply or demand', () => {
            let mr1 = ext.moment();
            let mr2 = ext.moment();
            let mr3 = ext.moment();
            let mr4 = ext.moment();
            let mr5 = ext.moment();

            // |> Given resource that are supplied and demanded
            ext.behavior([mr1], [mr2], ext => {
                mr1.value;
                mr1.event;
                mr1.justUpdated;
                mr2.value;
                mr2.event;
                mr2.justUpdated;
            });
            ext.addToGraphWithAction();

            // |> When they are accessed inside a behavior during an event
            // |> Then it will succeed
            mr1.updateWithAction();

            // |> And when they are accessed outside an event or behavior
            // |> Then it will succeed
            mr1.value;
            mr1.event;
            mr1.justUpdated;

            // |> And when we access a non-supplied resource inside an action
            // |> Then it will succeed
            g.action(() => {
                mr1.value;
            });

            // |> But Given behaviors that access value, event, or justUpdated for a resource
            // that is not supplied or demanded
            let ext2 = new Extent(g);
            ext2.behavior([mr3], null, ext => {
                mr2.value;
            });

            ext2.behavior([mr4], null, ext => {
                mr2.event;
            });

            ext2.behavior([mr5], null, ext => {
                mr2.justUpdated;
            });
            ext2.addToGraphWithAction();

            // |> Then it will fail
            expect(() => {
                mr3.updateWithAction();
            }).toThrow();

            expect(() => {
                mr4.updateWithAction();
            }).toThrow();

            expect(() => {
                mr5.updateWithAction();
            }).toThrow();

            // |> And when we access a supplied resource from an action
            // |> Then it will fail
            expect(() => {
                mr2.updateWithAction();
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

        g.action(() => {
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

    test('ordering resources arent called', () => {
        // |> Given a behavior with an ordering demand
        let run = false;
        ext.behavior([r_a, r_b.order], null, ext1 => {
            run = true;
        });
        ext.addToGraphWithAction();

        // |> When that demand is updated
        r_b.updateWithAction(1);

        // |> Then that behavior doesn't run
        expect(run).toBeFalsy();
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

        g.action(() => {
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

        g.action(() => {
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
        let y_bhv = ext.behavior([r_a, reordering], [y_out], (extent: Extent) => {
            whenY = counter;
            counter = counter + 1;
        });

        ext.behavior([r_a], [reordering], (extent: Extent) => {
            x_bhv.setDynamicDemands([y_out]);
            y_bhv.setDynamicDemands([]);
        });

        ext.addToGraphWithAction();

        // this sets them one way
        g.action(() => {
            x_bhv.setDynamicDemands([]);
            y_bhv.setDynamicDemands([x_out]);
        });

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
        g.action(() => {
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
        g.action(() => {
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
        g.action(() => {
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
        g.action(() => {
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

        g.action(() => {
            ext.addToGraph();
            ext2.addToGraph();
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

        g.action(() => {
            b1.setDynamicDemands([r_a]);
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
            b1.setDynamicDemands([r_a]);
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

        g.action(() => {
            b1.setDynamicSupplies([r_a]);
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
        g.action(() => {
            b_b.setDynamicSupplies([r_x]);
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
        let b1 = ext.behavior(null, null, (extent) => {
            // do nothing
        });
        ext.addToGraphWithAction();
        ext.action(() => {
            b1.setDynamicSupplies([m1])
        });
        expect(m1.suppliedBy).not.toBeNull();

        // |> When that behavior no longer supplies that original resource
        ext.action(() => {
            b1.setDynamicSupplies(null);
        });

        // |> Then that resource should free to be supplied by another behavior
        expect(m1.suppliedBy).toBeNull();
    });

    test('dynamicDemands clause updates demands', () => {
        // |> Given a behavior with dynamicDemands
        let m1 = ext.moment();
        let m2 = ext.moment();
        let m3 = ext.moment();
        let runCount = 0;
        let relinkBehaviorOrder = 0;
        let behaviorOrder = 0;
        ext.behavior()
            .demands(m1)
            .dynamicDemands([m2], ext1 => {
                return [m3];
                relinkBehaviorOrder = ext1.graph.currentBehavior!.order;
            })
            .runs(ext1 => {
                runCount++;
                behaviorOrder = ext1.graph.currentBehavior!.order;
            });
        ext.addToGraphWithAction();

        // |> When net yet demanded resource is updated
        m3.updateWithAction();

        // |> Then behavior is not run
        expect(runCount).toBe(0);

        // |> And when an update activates a relink and we update
        m2.updateWithAction();
        m3.updateWithAction();

        // |> Then behavior will be run
        expect(runCount).toBe(1);

        // |> And when we update original static resource
        m1.updateWithAction();

        // |> Then we expect behavior to also run
        expect(runCount).toBe(2);

        // |> Relink behavior should be a prior to its behavior
        // This ensures that relinking happens before behavior is run
        expect(behaviorOrder).toBeGreaterThan(relinkBehaviorOrder);
    });

    test('dynamicSupplies clause updates supplies', () => {
        // |> Given a behavior with dynamicSupplies
        let m1 = ext.moment();
        let m2 = ext.moment();
        let m3 = ext.moment();

        let relinkingBehaviorOrder = 0;
        let behaviorOrder = 0;
        ext.behavior()
            .demands(m1)
            .dynamicSupplies([m2], ext1 => {
                relinkingBehaviorOrder = ext1.graph.currentBehavior!.order;
                return [m3];
            })
            .runs(ext1 => {
                behaviorOrder = ext1.graph.currentBehavior!.order;
                m3.update();
            });
        ext.addToGraphWithAction();

        // |> When behavior activated before relink is activated
        // |> Then action should throw because behavior does not supply that resource
        expect(() => {
            m1.update();
        }).toThrow(); // cannot update unsupplied resource

        // |> And when behavior has its supplies relinked
        m2.updateWithAction();

        // |> Then the behavior can activate and update the newly supplied resource
        g.action(() => {
            m1.update();
            g.sideEffect(() => {
                expect(m3.justUpdated).toBeTruthy();
            });
        });

        // |> And behavior is ordered greater than the relinking behavior to ensure
        // it is updated before running
        expect(behaviorOrder).toBeGreaterThan(relinkingBehaviorOrder);
    });

    test('setDynamicDemands retains statics', () => {
        // |> Given a behavior with static demands
        let m1 = ext.moment();
        let m2 = ext.moment();
        let run = false;
        let b1 = ext.behavior([m1], null, ext1 => {
            run = true;
        });
        ext.addToGraphWithAction();

        // |> When dynamicDemands are set
        g.action(() => {
            b1.setDynamicDemands([m2]);
        });

        // |> Then behavior runs on newly added dynamicDemand
        m2.updateWithAction()
        expect(run).toBeTruthy();

        // |> And when static demand is updated
        run = false
        m1.updateWithAction()

        // |> Then it will also update
        expect(run).toBeTruthy();
    });

    test('setDynamicSupplies retains statics', () => {
        // |> Given behavior that supplies one resource
        let m1 = ext.moment();
        let m2 = ext.moment();
        let m3 = ext.moment();
        let b1 = ext.behavior([m1], [m2], ext1 => {
            m2.update();
            m3.update();
        });
        ext.addToGraphWithAction();

        // |> When I setDynamicSupplies to supply both and activate it
        g.action(() => {
            b1.setDynamicSupplies([m3]);
        });

        // |> Then behavior updates both successfully
        g.action(() => {
            m1.update();
            g.sideEffect(() => {
                expect(m2.justUpdated).toBeTruthy();
                expect(m3.justUpdated).toBeTruthy();
            });
        });
    });

    test('updating demands on behavior that has already run will affect future events', () => {
        // |> Given a behavior that demands one resource
        let m1 = ext.moment();
        let m2 = ext.moment();
        let run = false;
        ext.behavior([m1], null, ext1 => {
            ext1.graph.currentBehavior!.setDynamicDemands([m2]);
            run = true;
        });
        ext.addToGraphWithAction();

        // It doesn't activate on other resource
        m2.updateWithAction();
        expect(run).toBeFalsy();

        // |> When behavior updates demands on itself to include m2
        m1.updateWithAction();
        run = false;

        // |> Then m2 updating will activate the behavior
        m2.updateWithAction();
        expect(run).toBeTruthy();
    });
});



describe('Extents', () => {

    class TestExtent extends Extent {
        r1: State<number>;
        r2: State<number>;
        b1: Behavior;

        constructor(graph: Graph) {
            super(graph);
            this.r1 = this.state(0);
            this.r2 = this.state(0, 'custom_r2');
            this.b1 = this.behavior([this.r1], [this.r2], (extent: TestExtent) => {
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

        expect(e.debugConstructorName).toBe('TestExtent');
    })

    test('contained components picked up', () => {
        let e = new TestExtent(g);
        e.addToGraphWithAction();

        expect(e.r1.graph).toBe(g);
        expect(e.b1.extent).toBe(e);
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
});

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
            b_x.setDynamicDemands([r_a]);
        }).toThrow();

        expect(() => {
            b_x.setDynamicSupplies([r_b]);
        }).toThrow();
    });

    test('check can\'t update demands or supplies on behavior not in graph', () => {
        let b_x = ext.behavior([], [], extent => {
        });

        expect(() => {
            g.action(() => {
                b_x.setDynamicDemands([r_a]);
            });
        }).toThrow();

        expect(() => {
            g.action(() => {
                b_x.setDynamicSupplies([r_a]);
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
            g.action(() => {
                ext.sideEffect((extent) => {
                    g.action(() => {
                        innerAction = true;
                    });
                }, 'action')
                ext.sideEffect((extent) => {
                    throw(new Error());
                }, 'innerEffect');
                ext.sideEffect((extent) => {
                    innerEffect = true;
                }, 'effect');
            });
        }).toThrow();

        // |> When trying to run another event
        g.action(() => {
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
            b3.setDynamicDemands([]);
            b3.setDynamicSupplies([]);
            throw(new Error());
        });
        b3 = ext.behavior([r3], null, extent => {
            // do nothing
        });
        ext.addToGraphWithAction();
        expect(() => {
            g.action(() => {
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
            g.action(() => {
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
            extent.sideEffect(extent => {
                happened = true;
            }, 'happen');
            r_b.update(1);
        });

        // b depends on a
        // check that side effect didn't happen during b's run
        ext.behavior([r_b], null, extent => {
            expect(happened).toBeFalsy();
            extent.sideEffect((extent) => {
                expect(happened).toBeTruthy();
            }, 'after effect');
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
            ext.sideEffect((extent) => {
                whenX = counter;
                counter += 1;
            }, 'first');
            r_b.update(1);
        });
        ext.behavior([r_b], null, extent => {
            ext.sideEffect((extent) => {
                whenY = counter;
                counter += 1;
            }, 'second');
        });

        ext.addToGraphWithAction();
        r_a.updateWithAction(1);

        expect(whenY).toBeGreaterThan(whenX);
    });

    test('transient values are cleared after effects are run', () => {
        let r1 = ext.moment('r1');
        ext.behavior([r_a], [r1], extent => {
            r1.update();
            extent.sideEffect((extent) => {
                expect(r_a.justUpdatedTo(1)).toBeTruthy();
                expect(r1.justUpdated).toBeTruthy();
            }, 'after');
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
                    ext.action(() => {
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
            extent.sideEffect((extent) => {
                extent.graph.action(() => {
                    eventLoopOrder = effectCounter++;
                });
            }, 'effect 1');
            extent.sideEffect((extent) => {
                effect2Order = effectCounter++;
            }, 'effect 2');
        });
        ext.addToGraphWithAction();

        // |> When the first effect initiates a new event
        m1.updateWithAction();

        // |> Then the second effect will run before the new event
        expect(effect2Order).toEqual(0);
        expect(eventLoopOrder).toEqual(1);
    });

    /*
    11/15/2021-- Actions created directly from within a behavior seem closer to a mistake
    even if they could be rewritten as sideEffects. They are now disallowed.
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
            extent.action(() => {
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
            extent.action(() => {
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
     */

    test('actions are run synchronously by default when there is only one', () => {
        // |> Given there are no running events
        let counter = 0;
        ext.addToGraphWithAction();

        // |> When an action is added
        ext.action(() => {
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
        ext.action(() => {
            ext.sideEffect((extent) => {
                ext.action(() => {
                    actionIsRun = counter;
                    counter = counter + 1;
                });
                effectIsRun = counter;
                counter = counter + 1;
            }, 'side effect');
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
        ext.action(() => {
            ext.sideEffect((extent) => {
                ext.actionAsync(() => {
                    actionIsRun = counter;
                    counter = counter + 1;
                });
                effectIsRun = counter;
                counter = counter + 1;
            }, 'side effect');
        });

        // |> Then it will be run after first event completes entirely
        expect(effectIsRun).toBe(1);
        expect(actionIsRun).toBe(2);
    });

    test('actionAsync runs immediately if no current events', () => {
        let effectIsRun = false;
        ext.addToGraphWithAction();
        ext.actionAsync(() => {
            ext.sideEffect((extent) => {
                effectIsRun = true;
            }, 'side effect');
        });

        expect(effectIsRun).toBeTruthy();
    });

    test('actionAsync returns promise which is resolved asynchronously when event loop completes', () => {
        // |> Given a promise from the actionAsync call
        // |> When it is run
        // |> Then the action will be started immediately with a new event loop
        //    and it will complete side effects
        //    and will resolve promise
        //    which will run asynchronously after actionAsync call completes
        let order: number[] = [];
        let p = g.actionAsync(() => {
            order.push(1);
            g.sideEffect(() => {
                order.push(2);
            });
        }).then(() => {
            order.push(4);
            expect(order).toStrictEqual([1, 2, 3, 4]);
        });
        order.push(3);
        return p;
    });

    test('actionAsync exits on extent', () => {
        // |> Given a promise from the actionAsync call
        // |> When it is run
        // |> Then the action will be started immediately with a new event loop
        //    and it will complete side effects
        //    and will resolve promise
        //    which will run asynchronously after actionAsync call completes
        let order: number[] = [];
        let p = ext.actionAsync((ext1) => {
            order.push(1);
            ext1.sideEffect((ex) => {
                order.push(2);
            });
        }).then(() => {
            order.push(4);
            expect(order).toStrictEqual([1, 2, 3, 4]);
        });
        order.push(3);
        return p;
    });

    test('promise is resolved at the end of existing event loop', (done) => {
        // |> Given an existing event loop
        // |> When actionAsync are called
        // |> They will be run at the end of the existing event loop
        let firstCalled = false;
        let secondCalled = false;
        g.action(() => {
            g.sideEffect(() => {
                Promise.all([
                    g.actionAsync(() => {
                        firstCalled = true;
                    }),
                    g.actionAsync(() => {
                        secondCalled = true;
                    })
                ]).then(() => {
                    expect(firstCalled && secondCalled).toBeTruthy();
                    done();
                });
            });
        });

    });

    test('errors from async action are available', () => {
        // |> Given a behavior that supplies a resource
        let mr1 = ext.moment();
        ext.behavior(null, [mr1], ext => {

        });
        ext.addToGraphWithAction();


        // |> When an actionAsync causes error by updating a supplied resource
        // |> Then there will be an error which is rejected asynchronously
        return g.actionAsync(() => {
            mr1.update(); // will fail, because its already supplied
        }).catch(error => {
            expect(error).not.toBeNull();
        });
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
            ext.sideEffect((extent) => {
                // do nothing
            }, 'should throw');
        }).toThrow();
    });

    test('actions have knowledge of changes for debugging', () => {
        // |> Given a subsequent behavior
        let m1 = ext.moment('m1')
        let m2 = ext.moment('m2')
        let m3 = ext.moment('m3')

        let actionUpdatesDuring;
        ext.behavior([m1], [m3], extent => {
            m3.update()
            actionUpdatesDuring = extent.graph.eventLoopState?.actionUpdates;
        });
        ext.addToGraphWithAction();

        // |> When action updates multiple resources
        g.action(() => {
            m1.update();
            m2.update();
        });

        // |> Then that information is available during the current event
        expect(actionUpdatesDuring).toStrictEqual([m1, m2]);
        expect(g.eventLoopState?.actionUpdates).toBeUndefined();
    });

    test('actions have debugName', () => {
        let m1 = ext.moment();
        let s1 = ext.state<number>(1);
        let lastActionName;
        ext.behavior([ext.addedToGraph, m1, s1], null, extent => {
            lastActionName = extent.graph.eventLoopState?.action.debugName;
        });
        ext.addToGraphWithAction('added');
        expect(lastActionName).toBe('added');

        g.action(() => {
            m1.update();
        }, '1');

        expect(lastActionName).toBe('1');

        g.actionAsync(() => {
            m1.update();
        }, '2');

        expect(lastActionName).toBe('2');

        m1.updateWithAction(undefined, '3');

        expect(lastActionName).toBe('3');

        s1.updateWithAction(2, '4');

        expect(lastActionName).toBe('4');

        ext.action(() => {
            m1.update();
        }, '5');

        expect(lastActionName).toBe('5');

        ext.actionAsync(() => {
            m1.update();
        }, '6');

        expect(lastActionName).toBe('6');
    });

    test('sideEffects have debugName', () => {
        let m1 = ext.moment();
        let m2 = ext.moment();
        let firstSideEffectName;
        let secondSideEffectName;
        ext.behavior([m1], [m2], extent => {
            m2.update();
            extent.sideEffect(extent1 => {
                firstSideEffectName = extent.graph.eventLoopState?.currentSideEffect?.debugName;
            }, '1');
        });
        ext.behavior([m2], null, extent => {
            extent.sideEffect(extent1 => {
                secondSideEffectName = extent.graph.eventLoopState?.currentSideEffect?.debugName;
            });
        });
        ext.addToGraphWithAction();
        m1.updateWithAction();

        expect(firstSideEffectName).toBe('1');
        expect(secondSideEffectName).toBeUndefined();
    });

    test('can create side effects with graph object', () => {
        let valueAfter = 0;
        let sideEffectName;
        g.action(() => {
            g.sideEffect(() => {
                valueAfter = 1;
                sideEffectName = g.eventLoopState?.currentSideEffect?.debugName;
            }, 'sideEffect1');
        });
        expect(valueAfter).toBe(1);
        expect(sideEffectName).toBe('sideEffect1');
    });

    test('defining behavior visible inside side effect', () => {
        let m1 = ext.moment();
        let definingBehavior;
        let createdBehavior = ext.behavior([m1], null, ext => {
            ext.sideEffect(extent => {
                definingBehavior = extent.graph.eventLoopState!.currentSideEffect!.behavior;
            });
        });

        ext.addToGraphWithAction();
        m1.updateWithAction();

        expect(definingBehavior).toBe(createdBehavior);
    });

    test('action inside sideEffect has extent', () => {
        let m1 = ext.moment();
        let insideExtent;
        ext.behavior([m1], null, ext => {
            ext.sideEffect(extent => {
                extent.action(extent1 => {
                    insideExtent = extent1;
                });
            });
        });
        ext.addToGraphWithAction();
        m1.updateWithAction();

        expect(insideExtent).toBe(ext);
    });

    test('nested actions are disallowed', () => {
        expect(() => {
            g.action(() => {
                g.action(() => {

                });
            });
        }).toThrow();
    });

    test('actions directly inside behaviors are disallowed', () => {
        ext.behavior([ext.addedToGraph], null, extent => {
            extent.action(extent => {
                // throws
            });
        });

        expect(() => {
            ext.addToGraphWithAction();
        }).toThrow();
    });

    test('sideEffect in sideEffect doesnt make sense', () => {
        expect(() => {
            g.action(() => {
                g.sideEffect(() => {
                    g.sideEffect(() => {
                        // throws
                    });
                });
            });
        }).toThrow();
    });
});

