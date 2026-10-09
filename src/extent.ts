//
//  Copyright Yahoo 2021
//


import {Graph} from "./graph.js";
import {Behavior, BehaviorBuilder} from "./behavior.js";
import {Moment, Resource, State} from "./resource.js";
import {RelinkingOrder} from "./common.js";
import {shadowedMemberMessage} from "./errors.js";

/** How {@link Extent.removeFromGraph} treats extents whose lifetimes are tied to this one. */
export enum ExtentRemoveStrategy {
    extentOnly,
    containedLifetimes
}

class ExtentLifetime {
    addedToGraphWhen: number | null = null;
    extents: Set<Extent> = new Set();
    children: Set<ExtentLifetime> | null = null;
    parent: ExtentLifetime | null = null;

    constructor(extent: Extent) {
        this.extents.add(extent);
        if (extent.addedToGraphWhen != null) {
            this.addedToGraphWhen = extent.addedToGraphWhen;
        }
    }

    unify(extent: Extent) {
        if (extent.addedToGraphWhen != null) {
            let err: any = new Error("Same lifetime relationship must be established before adding any extent to graph.");
            err.extent = extent;
            throw err;
        }
        if (extent.lifetime != null) {
            // merge existing lifetimes and children into one lifetime heirarchy
            // move children first
            if (extent.lifetime.children != null) {
                for (let child of extent.lifetime.children) {
                    this.addChildLifetime(child);
                }
            }
            // then make any extents in other lifetime part of this one
            for (let ext of extent.lifetime.extents) {
                ext.lifetime = this;
                this.extents.add(ext);
            }
        } else {
            extent.lifetime = this;
            this.extents.add(extent);
        }
    }

    addChild(extent: Extent) {
        if (extent.lifetime == null) {
            extent.lifetime = new ExtentLifetime(extent);
        }
        this.addChildLifetime(extent.lifetime!);
    }

    addChildLifetime(lifetime: ExtentLifetime) {
        let myLifetime: ExtentLifetime | null = this;
        while (myLifetime != null) {
            if (myLifetime === lifetime) {
                let err: any = new Error("Child lifetime cannot be a transitive parent.");
                err.extent = lifetime;
                throw err;
            }
            myLifetime = myLifetime.parent;
        }
        lifetime.parent = this;
        if (this.children == null) {
            this.children = new Set<ExtentLifetime>();
        }
        this.children!.add(lifetime);
    }

    hasCompatibleLifetime(lifetime: ExtentLifetime | null): boolean {
        if (this === lifetime) {
            // unified
            return true;
        } else if (lifetime != null) {
            // parents
            if (this.parent != null) {
                return this.parent.hasCompatibleLifetime(lifetime);
            }
        }
        return false;
    }

    getAllContainedExtents(): Extent[] {
        let extents = [];
        for (let ext of this.extents) {
            extents.push(ext);
        }
        if (this.children != null) {
            for (let childLifetime of this.children) {
                extents.push(...childLifetime.getAllContainedExtents());
            }
        }
        return extents;
    }

    getAllContainingExtents(): Extent[] {
        let extents = [];
        for (let ext of this.extents) {
            extents.push(ext);
        }
        if (this.parent != null) {
            extents.push(...this.parent.getAllContainingExtents());
        }
        return extents;
    }
}

// The values Extent's constructor gave its own fields, so addToGraph can tell when a subclass field replaced one.
const originalFields = new WeakMap<Extent, {[name: string]: unknown}>();
let extentMethodNames: string[] | null = null;

/**
 * Registers `cleanup` to run when the extent is removed from the graph, and returns a function
 * that runs it now instead. Calling the returned function more than once does nothing.
 */
export type OnRemove = (cleanup: () => void) => () => void;

interface Cleanup {
    run: () => void;
    done: boolean;
}

// Kept off Extent so the bookkeeping takes no member names away from subclasses.
class RemovalCleanups {
    pending: Set<Cleanup> = new Set();
    onRemove: OnRemove;

    constructor(extent: Extent) {
        this.onRemove = (run) => {
            let cleanup: Cleanup = {run: run, done: false};
            if (extent.addedToGraphWhen == null && extent.removedFromGraphWhen != null) {
                // the extent is already gone, so nothing will run it later
                runCleanup(cleanup);
                return () => {};
            }
            this.pending.add(cleanup);
            return () => {
                this.pending.delete(cleanup);
                runCleanup(cleanup);
            };
        };
    }
}

function runCleanup(cleanup: Cleanup) {
    if (!cleanup.done) {
        cleanup.done = true;
        cleanup.run();
    }
}

const removalCleanups = new WeakMap<Extent, RemovalCleanups>();

function cleanupsFor(extent: Extent): RemovalCleanups {
    let cleanups = removalCleanups.get(extent);
    if (cleanups === undefined) {
        cleanups = new RemovalCleanups(extent);
        removalCleanups.set(extent, cleanups);
    }
    return cleanups;
}

/** @internal */
export function onRemoveFor(extent: Extent): OnRemove {
    return cleanupsFor(extent).onRemove;
}

/**
 * Takes the cleanups registered so far and returns a function that runs them, newest first, or
 * null when there are none. Cleanups registered afterwards belong to the extent's next removal.
 * @internal
 */
export function takeRemovalCleanups(extent: Extent): (() => void) | null {
    let cleanups = removalCleanups.get(extent);
    if (cleanups === undefined || cleanups.pending.size == 0) {
        return null;
    }
    let taken = Array.from(cleanups.pending).reverse();
    cleanups.pending.clear();
    return () => {
        for (let cleanup of taken) {
            runCleanup(cleanup);
        }
    };
}

// A subclass field named like an Extent method or field (state, moment, action, graph, ...)
// hides it, and code that calls it breaks far from the cause. Name the field instead.
function checkShadowedMembers(extent: Extent) {
    if (extentMethodNames == null) {
        extentMethodNames = Object.getOwnPropertyNames(Extent.prototype).filter(name => name != "constructor");
    }
    for (let name of extentMethodNames) {
        if (Object.prototype.hasOwnProperty.call(extent, name)) {
            let err: any = new Error(shadowedMemberMessage(extent, name, true));
            err.extent = extent;
            throw err;
        }
    }
    let fields = originalFields.get(extent)!;
    for (let name in fields) {
        if ((extent as any)[name] !== fields[name]) {
            let err: any = new Error(shadowedMemberMessage(extent, name, false));
            err.extent = extent;
            throw err;
        }
    }
}

/**
 * A group of resources and behaviors with a shared lifetime. Subclass it, declare resources as
 * fields (`count = this.state(0)`), build behaviors in the constructor with
 * {@link Extent.behavior}, and add the instance to the graph with
 * {@link Extent.addToGraphWithAction}. Do not name a field after an Extent member (`state`,
 * `moment`, `action`, `graph`, ...); addToGraph throws if one is hidden.
 */
export class Extent {
    /** Internal: the subclass name, used in messages. Do not assign. */
    debugConstructorName: string | undefined;
    /** An optional name for this extent in debugging output. */
    debugName: string | undefined;
    /** The behaviors created on this extent. Do not assign. */
    behaviors: Behavior[] = [];
    /** The resources created on this extent. Do not assign. */
    resources: Resource[] = [];
    /** The graph this extent belongs to. Do not assign. */
    graph: Graph;
    /** Sequence of the event that added this extent to the graph, or null when it is not in the graph. */
    addedToGraphWhen: number | null = null;
    /** Internal: sequence of the event that removed this extent. Do not assign. */
    removedFromGraphWhen: number | null = null;
    /** True while the extent is in the graph; justUpdated in the event that adds it. Demand it to run a behavior on add. */
    addedToGraph: State<boolean>;
    /** Internal: set by unifyLifetime and addChildLifetime. Do not assign. */
    lifetime: ExtentLifetime | null = null;
    /** Shorthand for {@link ExtentRemoveStrategy.containedLifetimes}. */
    static readonly removeContainedLifetimes = ExtentRemoveStrategy.containedLifetimes;
    /** Shorthand for {@link RelinkingOrder.relinkingOrderSubsequent}. */
    static readonly relinkingOrderSubsequent = RelinkingOrder.relinkingOrderSubsequent;

    constructor(graph: Graph) {
        if (graph === null || graph === undefined) {
            let err: any = new Error("Extent must be initialized with an instance of Graph");
            err.extent = this;
            throw err;
        }
        this.debugConstructorName = this.constructor.name;
        this.graph = graph;
        this.addedToGraph = new State<boolean>(this, false);
        originalFields.set(this, {graph: this.graph, behaviors: this.behaviors, resources: this.resources, addedToGraph: this.addedToGraph});
    }

    /** Same as {@link Graph.debugHere}. */
    debugHere(): string {
        return this.graph.debugHere();
    }

    /**
     * Gives `extent` the same lifetime as this one, so behaviors on either may statically demand
     * and supply the other's resources. Both must then be added to the graph in the same event.
     */
    unifyLifetime<T extends Extent>(extent: T) {
        if (this.lifetime == null) {
            this.lifetime = new ExtentLifetime(this);
        }
        this.lifetime.unify(extent);
    }

    /**
     * Makes `extent` a child of this one: the child's behaviors may statically demand this
     * extent's resources, and removing this extent with
     * {@link ExtentRemoveStrategy.containedLifetimes} removes the child too. Call it before the
     * child is added to the graph. This extent reaches the child's resources only through
     * dynamicDemands.
     */
    addChildLifetime<T extends Extent>(extent: T) {
        if (this.lifetime == null) {
            this.lifetime = new ExtentLifetime(this);
        }
        this.lifetime.addChild(extent);
    }

    /** @internal */
    hasCompatibleLifetime<T extends Extent>(extent: T): boolean {
        if (this === extent as Extent) {
            return true;
        } else if (this.lifetime != null) {
            return (this.lifetime.hasCompatibleLifetime(extent.lifetime));
        } else {
            return false;
        }
    }

    /** @internal */
    addBehavior(behavior: Behavior) {
        this.behaviors.push(behavior);
    }

    /** @internal */
    addResource(resource: Resource) {
        this.resources.push(resource);
    }

    /** Adds this extent to the graph in a new action. Use it at setup, outside any event. */
    addToGraphWithAction(debugName?: string) {
        this.graph.action(() => {
            this.addToGraph();
        }, debugName);
    }

    /**
     * Adds this extent's resources and behaviors to the graph. Only valid inside an event (an
     * action or a behavior); use {@link Extent.addToGraphWithAction} from outside one.
     */
    addToGraph() {
        // before the event check, which would read a replaced graph
        checkShadowedMembers(this);
        if (this.graph.currentEvent != null) {
            this.nameResources();
            this.graph.addExtent(this);
        } else {
            let err: any = new Error("addToGraph must be called within an event.");
            err.extent = this;
            throw err;
        }
    }

    /** Removes this extent from the graph in a new action. */
    removeFromGraphWithAction(strategy?: ExtentRemoveStrategy, debugName?: string) {
        this.action(() => {
            this.removeFromGraph(strategy);
        }, debugName);
    }

    /**
     * Removes this extent from the graph; with {@link ExtentRemoveStrategy.containedLifetimes},
     * also every extent whose lifetime it contains. Only valid inside an event. Behaviors of a
     * removed extent stop running and updates to its resources are ignored. In the same event,
     * update whatever switches other behaviors' dynamic demands on its resources.
     */
    removeFromGraph(strategy?: ExtentRemoveStrategy) {
        let graph = this.graph;
        if (graph.currentEvent != null) {
            if (this.addedToGraphWhen != null) {
                if (strategy == ExtentRemoveStrategy.extentOnly || strategy === undefined || this.lifetime === null) {
                    graph.removeExtent(this);
                } else {
                    for (let ext of this.lifetime.getAllContainedExtents()) {
                        graph.removeExtent(ext);
                    }
                }
            }
        } else {
            let err: any = new Error("removeFromGraph must be called within an event.");
            err.extent = this;
            throw err;
        }
    }

    /**
     * Like {@link Graph.subscribeToJustUpdated}, passing this extent to `callback`. The
     * subscription ends when the extent is removed. Returns an unsubscribe function.
     */
    subscribeToJustUpdated(resources: Resource[], callback: (ext: this) => void): () => void {
        let unsubscribe = this.graph._subscribeToJustUpdated(resources, {extent: this, callback:callback as ((arg0: Extent | null) => void)});
        return onRemoveFor(this)(unsubscribe);
    }

    /** @internal */
    nameResources() {
        // automatically add any behaviors and resources that are contained
        // by this Extent object and name them with corresponding keys
        for (let key in this) {
            let object = this[key];
            if (object && (object as any)['isResource'] !== undefined) {
                if ((object as any as Resource).debugName == null) {
                    (object as any as Resource).debugName = key;
                }
            }
        }
    }

    /**
     * Starts a behavior: chain `.demands(...)`, `.supplies(...)` and optionally
     * `.dynamicDemands(...)` or `.dynamicSupplies(...)`, then finish with `.runs(block)`.
     */
    behavior(): BehaviorBuilder<this> {
        let b: BehaviorBuilder<this> = new BehaviorBuilder(this);
        return b;
    }

    /** Creates a resource with no value, for ordering (`r.order`) or as a link anchor. */
    resource(name?: string): Resource {
        return new Resource(this, name);
    }

    /** Creates a {@link Moment}: something that happened in one event, with an optional payload. */
    moment<T>(name?: string): Moment<T> {
        return new Moment<T>(this, name);
    }

    /** Creates a {@link State}: a value that persists across events. */
    state<T>(initialState: T, name?: string): State<T> {
        return new State<T>(this, initialState, name);
    }

    /**
     * Queues `block` to run, with this extent as its argument, after every activated behavior in
     * the current event has run. Side effects run in the order queued and are the only place to
     * touch the outside world (render, log, fetch, timers) or start another action. Only valid
     * inside a behavior or action.
     *
     * `onRemove` registers cleanup for what the side effect starts, next to the code that starts
     * it: `onRemove(() => clearTimeout(t))`. Registered cleanups run, newest first, in a side
     * effect of the event that removes this extent; if the extent is already removed, the cleanup
     * runs at once. `onRemove` returns a function that runs the cleanup early, for something that
     * ends before the extent does (a timer that restarts, a request a newer one replaces).
     */
    sideEffect(block: (ext: this, onRemove: OnRemove) => void, debugName?: string) {
        this.graph.sideEffectHelper({
            debugName: debugName,
            block: () => block(this, onRemoveFor(this)),
            extent: this,
            behavior: this.graph.currentBehavior
        });
    }

    /** Like {@link Graph.actionAsync}, passing this extent to the block. */
    async actionAsync(action: (ext: this) => void, debugName?: string) {
        return this.graph.actionAsyncHelper({
            block: action as (arg0: Extent | null) => void,
            debugName: debugName,
            extent: this,
            resolve: null
        })
    }

    /** Like {@link Graph.action}, passing this extent to the block. */
    action(action: (ext: this) => void, debugName?: string) {
        this.graph.actionHelper({
            block: action as (arg0: Extent | null) => void,
            debugName: debugName,
            extent: this,
            resolve: null
        })
    }
}
