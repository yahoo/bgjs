//
//  Copyright Yahoo 2021
//

// The code examples from AGENT_GUIDE.md, kept here so the guide cannot drift from the library.
// When an example in the guide changes, change it here too.

import {Extent, ExtentRemoveStrategy, Graph} from "../index.js";

// Section 3: minimal skeleton

type View = { count: number; greeting: string | null; loading: boolean };

interface Deps {
    fetchGreeting(count: number): Promise<string>;
    render(view: View): void;
}

class Counter extends Extent {
    pressed = this.moment();
    resetFired = this.moment();
    greetingArrived = this.moment<{ token: number; text: string | null }>();
    count = this.state(0);
    activeRequest = this.state<number | null>(null);
    greeting = this.state<string | null>(null);
    private timer: ReturnType<typeof setTimeout> | undefined;
    private nextToken = 1;
    disposed = false;

    constructor(graph: Graph, private readonly deps: Deps) {
        super(graph);

        this.behavior()
            .demands(this.pressed, this.resetFired)
            .supplies(this.count)
            .runs((ext) => {
                if (ext.resetFired.justUpdated) ext.count.update(0);
                else if (ext.pressed.justUpdated) ext.count.update(ext.count.value + 1);
            });

        this.behavior()
            .demands(this.pressed)
            .runs((ext) => {
                ext.sideEffect(() => {
                    clearTimeout(this.timer);
                    this.timer = setTimeout(() => {
                        this.timer = undefined;
                        if (!this.disposed) ext.resetFired.updateWithAction();
                    }, 1000);
                });
            });

        this.behavior()
            .demands(this.count, this.greetingArrived)
            .supplies(this.activeRequest, this.greeting)
            .runs((ext) => {
                if (ext.count.justUpdated) {
                    const token = this.nextToken++;
                    const count = ext.count.value;
                    ext.activeRequest.update(token);
                    ext.sideEffect(() => {
                        const arrived = (text: string | null) => {
                            if (!this.disposed) ext.greetingArrived.updateWithAction({token, text});
                        };
                        deps.fetchGreeting(count).then(arrived, () => arrived(null));
                    });
                }
                const reply = ext.greetingArrived.value;
                if (ext.greetingArrived.justUpdated && reply !== undefined && reply.token === ext.activeRequest.value) {
                    ext.activeRequest.update(null);
                    ext.greeting.update(reply.text);
                }
            });

        this.behavior()
            .demands(this.addedToGraph, this.count, this.greeting, this.activeRequest)
            .runs((ext) => {
                const view = {count: ext.count.value, greeting: ext.greeting.value, loading: ext.activeRequest.value !== null};
                ext.sideEffect(() => deps.render(view));
            });
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.removeFromGraphWithAction(ExtentRemoveStrategy.containedLifetimes);
    }
}

describe("AGENT_GUIDE skeleton", () => {
    let graph: Graph;
    let views: View[];
    let pending: Map<number, (text: string) => void>;
    let counter: Counter;

    const flush = () => new Promise((resolve) => jest.requireActual("timers").setImmediate(resolve));

    beforeEach(() => {
        jest.useFakeTimers();
        graph = new Graph();
        graph.validateTraceDemands = true;
        views = [];
        pending = new Map();
        counter = new Counter(graph, {
            fetchGreeting: (n) => new Promise((resolve) => { pending.set(n, resolve); }),
            render: (view) => { views.push(view); },
        });
        counter.addToGraphWithAction();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("renders once when added", () => {
        expect(views).toEqual([{count: 0, greeting: null, loading: false}]);
    });

    test("press counts, requests, and shows the reply", async () => {
        counter.pressed.updateWithAction();
        expect(counter.count.value).toBe(1);
        expect(views[views.length - 1]).toEqual({count: 1, greeting: null, loading: true});

        pending.get(1)!("hello 1");
        await flush();
        expect(views[views.length - 1]).toEqual({count: 1, greeting: "hello 1", loading: false});
    });

    test("a stale reply is ignored", async () => {
        counter.pressed.updateWithAction();
        counter.pressed.updateWithAction();
        pending.get(1)!("stale");
        await flush();
        expect(counter.greeting.value).toBeNull();
        expect(counter.activeRequest.value).not.toBeNull();

        pending.get(2)!("fresh");
        await flush();
        expect(counter.greeting.value).toBe("fresh");
    });

    test("the timer resets the count, and restarts on every press", () => {
        counter.pressed.updateWithAction();
        jest.advanceTimersByTime(900);
        counter.pressed.updateWithAction();
        jest.advanceTimersByTime(900);
        expect(counter.count.value).toBe(2);
        jest.advanceTimersByTime(100);
        expect(counter.count.value).toBe(0);
    });

    test("nothing happens after dispose", async () => {
        counter.pressed.updateWithAction();
        counter.dispose();
        const rendered = views.length;
        jest.advanceTimersByTime(2000);
        pending.get(1)!("late");
        await flush();
        expect(views.length).toBe(rendered);
        expect(counter.count.value).toBe(1);
    });
});

// Section 4: collections whose membership changes

class Item extends Extent {
    done = this.state(false);
    toggle = this.moment();
    constructor(graph: Graph, readonly id: string) {
        super(graph);
        this.behavior().demands(this.toggle).supplies(this.done)
            .runs((ext) => { ext.done.update(!ext.done.value); });
    }
}

class List extends Extent {
    addRequested = this.moment<string>();
    removeRequested = this.moment<string>();
    items = this.state<Item[]>([]);
    doneCount = this.state(0);

    constructor(graph: Graph) {
        super(graph);

        this.behavior()
            .demands(this.addRequested, this.removeRequested)
            .supplies(this.items)
            .runs((ext) => {
                if (ext.addRequested.justUpdated) {
                    const item = new Item(ext.graph, ext.addRequested.value!);
                    ext.addChildLifetime(item);
                    item.addToGraph();
                    ext.items.update([...ext.items.value, item]);
                }
                if (ext.removeRequested.justUpdated) {
                    const id = ext.removeRequested.value;
                    const gone = ext.items.value.filter((i) => i.id === id);
                    gone.forEach((i) => i.removeFromGraph());
                    ext.items.update(ext.items.value.filter((i) => i.id !== id));
                }
            });

        this.behavior()
            .demands(this.items)
            .dynamicDemands([this.items], (ext) => ext.items.value.map((i) => i.done))
            .supplies(this.doneCount)
            .runs((ext) => {
                ext.doneCount.update(ext.items.value.filter((i) => i.done.value).length);
            });
    }
}

describe("AGENT_GUIDE collection", () => {
    test("adds, toggles, aggregates and removes children", () => {
        const graph = new Graph();
        graph.validateTraceDemands = true;
        const list = new List(graph);
        list.addToGraphWithAction();

        list.addRequested.updateWithAction("a");
        list.addRequested.updateWithAction("b");
        const a = list.items.value[0];
        graph.action(() => { a.toggle.update(); });
        expect(list.doneCount.value).toBe(1);

        list.removeRequested.updateWithAction("a");
        expect(list.items.value.map((i) => i.id)).toEqual(["b"]);
        expect(list.doneCount.value).toBe(0);

        list.removeFromGraphWithAction(ExtentRemoveStrategy.containedLifetimes);
        expect(list.items.value[0].addedToGraphWhen).toBeNull();
    });

    test("a child's behavior runs in the event it is added when a demand is justUpdated", () => {
        const graph = new Graph();
        let ranIn: number | null = null;
        class Child extends Extent {
            constructor(graph: Graph) {
                super(graph);
                this.behavior().demands(this.addedToGraph).runs((ext) => { ranIn = ext.graph.currentEvent!.sequence; });
            }
        }
        const child = new Child(graph);
        child.addToGraphWithAction();
        expect(ranIn).toBe(graph.lastEvent.sequence);
    });
});
