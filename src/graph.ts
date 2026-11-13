//
//  Copyright Yahoo 2021
//


import {cycleMessage, demandNotAddedMessage, droppedActionMessage, droppedNestedActionMessage, lifetimeMessage, removedDemandMessage, removedSupplyMessage, sideEffectAfterNestedActionMessage, unmarkedNestedActionMessage} from "./errors.js";
import {BufferedPriorityQueue} from "./bufferedqueue.js";
import {Behavior} from "./behavior.js";
import {Extent, isChildLifetime, takeRemovalCleanups} from "./extent.js";
import {Demandable, Resource} from "./resource.js";
import {DateProvider, GraphEvent, LinkType, OrderingState, Subscription, Transient} from "./common.js";

interface StateInternal<T> {
    _updateForce(newValue: T): void;
}

interface SideEffect {
    block: (extent: Extent | null) => void;
    extent: Extent | null;
    behavior: Behavior | null;
    debugName?: string;
}

interface Action {
    block: (extent: Extent | null) => void;
    extent: Extent | null;
    resolve: ((value: any) => void) | null;
    reject?: ((reason: any) => void) | null;
    debugName?: string;
    // set when the event loop opens this action's event
    started?: boolean;
    // the action whose event was running when this one was started, if any
    parent?: Action | null;
}

// The action whose event was running when an error was thrown, recorded where the error first
// leaves the event loop or a side effect block. A nested action's caller owns an error only if
// it came from that action or from actions it started (see actionHelper).
const errorSource = new WeakMap<object, Action>();

function noteErrorSource(error: any, action: Action | null | undefined) {
    if (action != null && error != null && typeof error == "object" && !errorSource.has(error)) {
        errorSource.set(error, action);
    }
}

function isStartedBy(source: Action | null | undefined, action: Action): boolean {
    for (let a = source; a != null; a = a.parent) {
        if (a === action) {
            return true;
        }
    }
    return false;
}

// One running side effect block. Side effects nest when one starts a synchronous action: the
// nested event loop runs inside the block, so frames form a stack.
/** @internal */
export interface EffectFrame {
    effect: SideEffect;
    event: GraphEvent;
    // the action that opened that event
    action: Action;
    // true once a synchronous action started by this block has returned; the rest of the block
    // then runs outside any event
    resumed: boolean;
    // depth of graph.reentrant calls open inside this block
    reentrant: number;
    // true once this block has logged an unmarked nested action
    logged: boolean;
    // an error from finishing this frame's event, raised inside an action this block started;
    // rethrown by the loop that runs the block so the block cannot swallow it
    pendingError: any;
}

const DefaultDateProvider = {
    now: () => {
        return new Date();
    }
}

/**
 * Owns the event loop. Usually there is one per application. Every {@link Extent} belongs to a
 * graph, and every change to the graph's resources happens inside an event that an action opens.
 *
 * See AGENT_GUIDE.md in this package for the mental model, patterns and errors.
 */
export class Graph {
    /** Supplies the timestamp of each new event. Replace it to control time in tests. */
    dateProvider: DateProvider = DefaultDateProvider;
    /** The event in progress, or null between events. */
    currentEvent: GraphEvent | null = null;
    /** The last completed event. Sequence 0 before the first action. */
    lastEvent: GraphEvent;
    /** @internal */
    activatedBehaviors: BufferedPriorityQueue<Behavior> = new BufferedPriorityQueue();
    /** The behavior whose `runs` block is executing, or null (including during side effects). */
    currentBehavior: Behavior | null = null;
    /** @internal */
    effects: SideEffect[] = [];
    /** @internal */
    actions: Action[] = [];
    /** @internal */
    untrackedBehaviors: Behavior[] = [];
    /** @internal */
    modifiedDemandBehaviors: Behavior[] = [];
    /** @internal */
    modifiedSupplyBehaviors: Behavior[] = [];
    /** @internal */
    updatedTransients: Transient[] = [];
    /** @internal */
    needsOrdering: Behavior[] = [];
    /** @internal */
    eventLoopState: EventLoopState | null = null;
    /** @internal */
    extentsAdded: Extent[] = [];
    /** @internal */
    extentsRemoved: Extent[] = [];
    /**
     * When true (the default), a behavior may statically demand or supply another extent's
     * resources only if that extent has the same lifetime ({@link Extent.unifyLifetime}) or is an
     * ancestor ({@link Extent.addChildLifetime}). Reach other extents through dynamicDemands.
     */
    validateLifetimes: boolean = true;
    /**
     * When true, a behavior may read `state.traceValue` or `state.traceEvent` only if it supplies
     * or demands the state, or declares `state.trace` in its demands. On by default since 2.0;
     * set it to false to run 1.x code that reads traceValue without declaring it while migrating.
     */
    validateTraceDemands: boolean = true;
    /**
     * When true (the default), reading `moment.value` when the moment did not update in the
     * current event (or outside any event) throws, instead of returning `undefined` as if it
     * were an empty payload. On by default since 3.0; set it to false to run 2.x code that reads
     * the value before checking `justUpdated` while migrating.
     */
    validateMomentReads: boolean = true;
    /** @internal */
    justUpdatedCallbacks: Set<Subscription> = new Set();
    /** @internal */
    effectFrames: EffectFrame[] = [];
    /**
     * Receives each warning's text. A warning reports code that works but may not do what was
     * meant, such as a side effect that starts a synchronous action without
     * {@link Graph.reentrant}. Defaults to `console.warn`. Replace it to collect warnings, throw, or
     * stop at a breakpoint; set it to null to skip them.
     */
    onWarning: ((message: string) => void) | null = (message) => console.warn(message);
    /** @internal */
    activationCount: number = 0;
    /** @internal Bumped whenever links change, so reverse-mode priorities are recomputed. */
    heightGeneration: number = 0;
    /** @internal */
    linksChanged: boolean = false;
    private _reverseUnordered: boolean = false;

    /**
     * The initial value of {@link Graph.reverseUnordered} for graphs created afterwards. Set it
     * in a test setup file to run a whole suite in reversed order without changing app code.
     */
    static reverseUnorderedDefault: boolean = false;

    constructor() {
       this.lastEvent = GraphEvent.initialEvent;
       this.reverseUnordered = Graph.reverseUnorderedDefault;
    }

    /**
     * Debug mode for tests. Behaviors with no dependency path between them run in an order the
     * graph does not promise, and so do their side effects. When true, the graph runs such
     * behaviors in a different valid order: as late as their dependents allow, with ties in
     * reverse activation order. Run your tests both ways; a test that passes in only one order
     * depends on an order nothing declared. Fix it with one output behavior or a `.order` demand.
     * Defaults to {@link Graph.reverseUnorderedDefault}.
     */
    get reverseUnordered(): boolean {
        return this._reverseUnordered;
    }

    set reverseUnordered(value: boolean) {
        if (value != this._reverseUnordered) {
            this._reverseUnordered = value;
            this.activatedBehaviors.reversed = value;
            this.linksChanged = true;
            this.activatedBehaviors.unsort();
        }
    }

    /**
     * Opens an event, runs `block`, then runs every activated behavior and side effect. Returns
     * when the event, and any events its side effects started, have completed. Inside `block`,
     * update resources that no behavior supplies. Throws if called inside a behavior or another
     * action; start actions from side effects or outside code.
     */
    action(block: () => void, debugName?: string) {
        this.actionHelper({debugName: debugName, block: block, extent: null, resolve: null});
    }

    /** @internal */
    actionHelper(action: Action) {
        if (this.eventLoopState != null && (this.eventLoopState.phase == EventLoopPhase.action || this.eventLoopState.phase == EventLoopPhase.updates)) {
            let err: any = new Error("Action cannot be created directly inside another action or behavior. Consider wrapping it in a side effect block.");
            throw err;
        }
        this.prepareAction(action);
        let frame = this.eventLoopState?.phase == EventLoopPhase.sideEffects ? this.effectFrames[this.effectFrames.length - 1] : undefined;
        if (frame !== undefined && frame.reentrant == 0 && !frame.logged) {
            // before queuing, so a throwing onWarning leaves nothing behind to run later
            frame.logged = true;
            this.onWarning?.(unmarkedNestedActionMessage(frame.effect, frame.event));
        }
        this.actions.push(action);
        if (frame === undefined) {
            this.eventLoop();
            return;
        }
        // Started from a side effect. The nested loop first finishes the side effect's event
        // (its remaining side effects), then any queued actions, then this one, and returns once
        // all have completed, so the caller sees a synchronous action.
        try {
            this.eventLoop();
        } catch (error) {
            if (isStartedBy(errorSource.get(error as object), action)) {
                // this action's own event, or an action it started, failed: the caller's error
                throw error;
            }
            // Other work this call ran failed: most often another side effect of the caller's
            // event, before this action, or another action queued around it. Tell the caller,
            // and keep the original for the loop running the caller's block, so catching this
            // cannot hide it.
            frame.pendingError = error;
            let err: any = new Error(droppedNestedActionMessage(frame.effect, frame.event, error, action.started == true));
            err.cause = error;
            throw err;
        } finally {
            frame.resumed = true;
        }
    }

    /**
     * Like {@link Graph.action}, but returns a promise that resolves when the action's event has
     * completed. Called during an event (from a side effect), the action is queued and runs after
     * the current event rather than nested. The promise rejects if the action's event fails, or if
     * an earlier failure drops the action before it runs (then `err.cause` is the original error).
     * Prefer `action` unless you need this.
     */
    async actionAsync(block: () => void, debugName?: string) {
        return this.actionAsyncHelper({debugName: debugName, block: block, extent: null, resolve: null})
    }

    /** @internal */
    async actionAsyncHelper(action: Action) {
        return new Promise((resolve, reject) => {
            try {
                if (this.eventLoopState != null && (this.eventLoopState.phase == EventLoopPhase.action || this.eventLoopState.phase == EventLoopPhase.updates)) {
                    let err: any = new Error("Action cannot be created directly inside another action or behavior. Consider wrapping it in a side effect block.");
                    throw err;
                }
                this.prepareAction(action);
                action.resolve = resolve;
                action.reject = reject;
                this.actions.push(action);
                if (this.currentEvent == null) {
                    this.eventLoop();
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    // Records which action is starting this one. If the side effect starting it caught a report
    // that other work failed, the graph is unwinding: rethrow the original instead of running
    // more work on an abandoned event.
    private prepareAction(action: Action) {
        let top = this.effectFrames[this.effectFrames.length - 1];
        if (top?.pendingError != null) {
            throw top.pendingError;
        }
        action.parent = this.eventLoopState?.action ?? top?.action ?? null;
    }

    private eventLoop() {

        while (true) {

            try {
                if (this.activatedBehaviors.length > 0 ||
                    this.untrackedBehaviors.length > 0 ||
                    this.modifiedDemandBehaviors.length > 0 ||
                    this.modifiedSupplyBehaviors.length > 0 ||
                    this.needsOrdering.length > 0) {

                    this.eventLoopState!.phase = EventLoopPhase.updates;
                    let sequence = this.currentEvent!.sequence;
                    if (this.untrackedBehaviors.length > 0 || this.modifiedSupplyBehaviors.length > 0 || this.modifiedDemandBehaviors.length > 0) {
                        this.linksChanged = true;
                    }
                    this.addUntrackedBehaviors();
                    this.addUntrackedSupplies();
                    this.addUntrackedDemands(sequence);
                    this.orderBehaviors();
                    if (this._reverseUnordered && this.linksChanged) {
                        this.reprioritize();
                    }
                    this.runNextBehavior(sequence);

                    continue;
                }

                if (this.validateLifetimes) {
                    // validate removals first so extents removed without their children
                    // in the same event they were added report the removal error
                    if (this.extentsRemoved.length > 0) {
                        this.validateRemovedExtents();
                        this.extentsRemoved.length = 0;
                    }
                    if (this.extentsAdded.length > 0) {
                        this.validateAddedExtents();
                        this.extentsAdded.length = 0;
                    }
                }

                if (this.justUpdatedCallbacks.size > 0) {
                    this.turnSubscriptionsIntoSideEffects();
                }

                let effect = this.effects.shift();
                if (effect) {
                    this.eventLoopState!.phase = EventLoopPhase.sideEffects;
                    this.eventLoopState!.currentSideEffect = effect;
                    let frame: EffectFrame = {effect: effect, event: this.currentEvent!, action: this.eventLoopState!.action, resumed: false, reentrant: 0, logged: false, pendingError: null};
                    this.effectFrames.push(frame);
                    try {
                        effect.block(effect.extent);
                    } catch (error) {
                        let thrown = frame.pendingError ?? error;
                        noteErrorSource(thrown, frame.action);
                        throw thrown;
                    } finally {
                        this.effectFrames.pop();
                    }
                    if (frame.pendingError != null) {
                        // the block caught the report that its action was dropped
                        throw frame.pendingError;
                    }
                    if (this.eventLoopState != null) {
                        // side effect could create a synchronous action which would create a nested event loop
                        // which would clear out any existing event loop states
                        this.eventLoopState.currentSideEffect = null;
                    }
                    continue;
                }

                if (this.currentEvent) {
                    if (this.eventLoopState!.action.resolve != undefined) {
                        this.eventLoopState!.action.resolve(undefined);
                    }
                    this.clearTransients();
                    this.lastEvent = this.currentEvent!;
                    this.currentEvent = null;
                    this.eventLoopState = null;
                    this.currentBehavior = null;
                }

                let action = this.actions.shift();
                if (action) {
                    let newEvent = new GraphEvent(this.lastEvent.sequence + 1, this.dateProvider.now());
                    this.currentEvent = newEvent;
                    this.eventLoopState = new EventLoopState(action);
                    this.eventLoopState.phase = EventLoopPhase.action;
                    action.started = true;
                    action.block(action.extent);
                    continue;
                }

            } catch (error) {
                noteErrorSource(error, this.eventLoopState?.action);
                // settle every actionAsync promise this failure ends, so none stays pending
                let failed = this.eventLoopState?.action;
                let dropped = this.actions.splice(0);
                this.currentEvent = null;
                this.eventLoopState = null;
                this.effects.length = 0;
                this.currentBehavior = null;
                this.activatedBehaviors.clear();
                this.justUpdatedCallbacks.clear();
                this.clearTransients();
                this.modifiedDemandBehaviors.length = 0;
                this.modifiedSupplyBehaviors.length = 0;
                this.untrackedBehaviors.length = 0;
                this.extentsAdded.length = 0;
                this.extentsRemoved.length = 0;
                failed?.reject?.(error);
                for (let action of dropped) {
                    if (action.reject != null) {
                        let err: any = new Error(droppedActionMessage(action.debugName, error));
                        err.cause = error;
                        action.reject(err);
                    }
                }
                throw(error);
            }
            // no more tasks so we can exit the event loop
            break;
        }
    }

    private validateAddedExtents() {
        // ensure extents with same lifetime also got added
        let needAdding: Set<Extent> = new Set();
        for (let added of this.extentsAdded) {
            // extents added and then removed in the same event are validated as removed extents instead
            if (added.addedToGraphWhen == null) {
                continue;
            }
            if (added.lifetime != null) {
                for (let ext of added.lifetime.getAllContainingExtents()) {
                    if (ext.addedToGraphWhen == null) {
                        needAdding.add(ext);
                    }
                }
            }
        }
        if (needAdding.size > 0) {
            let err: any = new Error("All extents with unified or parent lifetimes must be added during the same event.");
            err.nonAddedExtents = needAdding;
            throw err;
        }
    }

    private validateRemovedExtents() {
        // validate extents with contained lifetimes are also removed
        let needRemoving: Set<Extent> = new Set();
        for (let removed of this.extentsRemoved) {
            if (removed.lifetime != null) {
                for (let ext of removed.lifetime.getAllContainedExtents()) {
                    if (ext.addedToGraphWhen != null) {
                        needRemoving.add(ext);
                    }
                }
            }
        }
        if (needRemoving.size > 0) {
            let err: any = new Error("All extents with unified or child lifetimes must be removed during the same event.");
            err.nonAddedExtents = needRemoving;
            throw err;
        }

        // validate removed resources are not still linked to remaining behaviors
        for (let removed of this.extentsRemoved) {
            for (let resource of removed.resources) {
                for (let demandedBy of resource.subsequents) {
                    if (demandedBy.extent.addedToGraphWhen != null) {
                        let err: any = new Error(removedDemandMessage(resource, demandedBy));
                        err.remainingBehavior = demandedBy;
                        err.removedResource = resource;
                        throw err;
                    }
                }
                if (resource.suppliedBy != null && resource.suppliedBy.extent.addedToGraphWhen != null) {
                    let err: any = new Error(removedSupplyMessage(resource, resource.suppliedBy));
                    err.remainingBehavior = resource.suppliedBy;
                    err.removedResource = resource;
                    throw err;
                }
            }
        }
    }

    private clearTransients() {
        if (this.updatedTransients.length > 0) {
            for (let transient of this.updatedTransients) {
                transient.clear();
            }
            this.updatedTransients.length = 0;
        }
    }

    /** @internal */
    trackTransient(resource: Transient) {
        this.updatedTransients.push(resource);
    }

    /** @internal */
    resourceTouched(resource: Resource) {
        if (this.currentEvent != null) {
            if (this.eventLoopState != null && this.eventLoopState.phase == EventLoopPhase.action) {
                this.eventLoopState.actionUpdates.push(resource);
            }
            for (let subsequent of resource.subsequents) {
                let isOrderingDemand = subsequent.orderingDemands != null && subsequent.orderingDemands.has(resource);
                if (!isOrderingDemand) {
                    this.activateBehavior(subsequent, this.currentEvent.sequence);
                }
            }
        }
    }

    private activateBehavior(behavior: Behavior, sequence: number) {
        if (behavior.enqueuedWhen == null || behavior.enqueuedWhen < sequence) {
            behavior.enqueuedWhen = sequence;
            behavior.activationSequence = ++this.activationCount;
            if (this._reverseUnordered && !this.linksChanged) {
                // with links mid-change, reprioritize sets it once relinking is done
                behavior.priority = -this.heightOf(behavior);
            }
            this.activatedBehaviors.push(behavior);
        }
    }

    private runNextBehavior(sequence: number) {
        // Run the top behavior and any others of the same order. Once a behavior has run, only
        // same-order behaviors may follow before the event loop relinks and reorders, including
        // after skipping a behavior whose extent was removed.
        let ranOrder: number | null = null;
        while (true) {
            let nextBehavior = this.activatedBehaviors.peek();
            if (nextBehavior === undefined || (ranOrder !== null && this.activatedBehaviors.rank(nextBehavior) != ranOrder)) {
                break;
            }
            this.activatedBehaviors.pop();
            if (nextBehavior.extent.addedToGraphWhen == null) {
                // this behavior's extent has been removed, skip it
                continue;
            }
            this.currentBehavior = nextBehavior;
            nextBehavior.block(nextBehavior.extent);
            this.currentBehavior = null;
            ranOrder = this.activatedBehaviors.rank(nextBehavior);
            if (this._reverseUnordered && this.linksChanged) {
                // a removal changed links; recompute priorities before running more
                break;
            }
        }
    }

    /**
     * Runs `callback` as a side effect at the end of any event in which one of `resources`
     * updated. Reading resource values inside it is allowed. Returns an unsubscribe function.
     */
    subscribeToJustUpdated(resources: Resource[], callback: () => void): () => void {
        return this._subscribeToJustUpdated(resources, {extent: null, callback: callback});
    }

    /** @internal */
    _subscribeToJustUpdated(resources: Resource[], subscription: Subscription): () => void {
        let allUnsubscribes: (()=>void)[] = [];
        for (let resource of resources) {
            let unsubscribe = resource._subscribeToJustUpdated(subscription);
            allUnsubscribes.push(unsubscribe);
        }
        let bigUnsubscribe = () => {
            for (let unsubscribe of allUnsubscribes) {
                unsubscribe();
            }
        }
        return bigUnsubscribe;
    }

    /** @internal */
    _notifyJustUpdatedSubscribers(subscribers: Set<Subscription>) {
        subscribers.forEach(subscription => {
            this.justUpdatedCallbacks.add(subscription);
        });
    }

    private turnSubscriptionsIntoSideEffects() {
        this.justUpdatedCallbacks.forEach(subscription => {
            // either subscription is not connected to an extent or extent is part of graph
            if (subscription.extent == null || subscription.extent.addedToGraphWhen != null) {
                this.sideEffectHelper({block: subscription.callback, behavior: null, extent: subscription.extent})
            }
        });
        this.justUpdatedCallbacks.clear();
    }

    /**
     * Queues `block` to run after every activated behavior in the current event has run. Side
     * effects run in the order queued and are the place to touch the outside world. Only valid
     * inside a behavior or action. Prefer {@link Extent.sideEffect}, which passes the extent.
     */
    sideEffect(block: () => void, debugName?: string) {
        this.sideEffectHelper({debugName: debugName, block: block, behavior: null, extent: null});
    }

    /** @internal */
    sideEffectHelper(sideEffect: SideEffect) {
        let resumed = this.resumedEffectFrame();
        if (resumed != null) {
            let err: any = new Error(sideEffectAfterNestedActionMessage(resumed.effect, resumed.event));
            throw err;
        }
        if (this.currentEvent == null) {
            let err: any = new Error("Effects can only be added during an event.");
            throw err;
        } else if (this.eventLoopState!.phase == EventLoopPhase.sideEffects) {
            let err: any = new Error("Nested side effects don't make sense");
            throw err;
        } else {
            this.effects.push(sideEffect);
        }
    }

    // The running side effect block, if a synchronous action it started has returned, so code
    // running now is the rest of that block, outside any event.
    private resumedEffectFrame(): EffectFrame | null {
        if (this.currentEvent != null) {
            return null;
        }
        let frame = this.effectFrames[this.effectFrames.length - 1];
        return frame?.resumed ? frame : null;
    }

    /**
     * Runs `block` and returns its result. Call it from a side effect around code that may start a
     * synchronous action, usually a call out to client code (a listener or callback), to say that
     * this is intended. Such an action still runs the way it always does: the side effect's event
     * finishes its remaining side effects, the new action runs to completion, then the call
     * returns, so code after it runs outside any event. Without `reentrant`, the graph reports that
     * through {@link Graph.onWarning}, once per side effect run. Not required; it only documents the
     * reentry and silences that message. Covers actions started anywhere inside `block`, however
     * deeply, but not those started by side effects of the events it runs. Outside a side effect
     * it just runs `block`.
     */
    reentrant<T>(block: () => T): T {
        let frame = this.eventLoopState?.phase == EventLoopPhase.sideEffects ? this.effectFrames[this.effectFrames.length - 1] : undefined;
        if (frame === undefined) {
            return block();
        }
        frame.reentrant += 1;
        try {
            return block();
        } finally {
            frame.reentrant -= 1;
        }
    }

    /** Text describing the current event: its sequence, the resources its action updated, and the current behavior. */
    debugHere(): string {
        let text = ""
        if (this.currentEvent != null) {
            text = "Current Event: " + this.currentEvent.sequence + "\n";
            text = text + "Action Updates:\n";
            this.eventLoopState?.actionUpdates.forEach(item => {
                text = text + " " + item.toString() + "\n";
            })
            if (this.currentBehavior != null) {
                text = text + "Current Behavior:\n";
                text = text + this.currentBehavior.toString();
            }
        } else {
            text = "No current event.";
        }
        return text
    }

    private addUntrackedBehaviors() {
        if (this.untrackedBehaviors.length > 0) {
            for (let behavior of this.untrackedBehaviors) {
                // extent may have been removed after it was added in the same event
                if (behavior.extent.addedToGraphWhen == null) {
                    continue;
                }
                this.modifiedDemandBehaviors.push(behavior);
                this.modifiedSupplyBehaviors.push(behavior);
            }
            this.untrackedBehaviors = [];
        }
    }

    private addUntrackedSupplies() {
        if (this.modifiedSupplyBehaviors.length > 0) {
            for (let behavior of this.modifiedSupplyBehaviors) {
                // don't link supplies for behaviors whose extent was removed after the modification
                if (behavior.extent.addedToGraphWhen == null) {
                    continue;
                }
                if (behavior.untrackedSupplies != null) {
                    for (let supply of behavior.untrackedSupplies) {
                        if (this.validateLifetimes && !behavior.extent.hasCompatibleLifetime(supply.extent)) {
                            let err: any = new Error(lifetimeMessage("supplies", supply, behavior, isChildLifetime(behavior.extent, supply.extent)));
                            err.currentBehavior = behavior;
                            err.supply = supply;
                            throw err;
                        }
                    }
                }

                let allUntrackedSupplies = [...(behavior.untrackedSupplies ?? []), ...(behavior.untrackedDynamicSupplies ?? [])];

                if (behavior.supplies != null) {
                    for (let existingSupply of behavior.supplies) {
                        existingSupply.suppliedBy = null;
                    }
                }
                behavior.supplies = new Set(allUntrackedSupplies);
                for (let newSupply of behavior.supplies) {
                    if (newSupply.suppliedBy != null && newSupply.suppliedBy != behavior) {
                        let describe = (b: any) => {
                            let ext = b.extent?.debugName ? ` in extent "${b.extent.debugName}"` : "";
                            let others = [...(b.untrackedSupplies ?? []), ...(b.untrackedDynamicSupplies ?? [])]
                                .filter((s: any) => s !== newSupply)
                                .map((s: any) => s.debugName ?? "<unnamed>");
                            let also = others.length > 0 ? ` (also supplies: ${others.join(", ")})` : " (supplies nothing else)";
                            return `behavior${ext}${also}`;
                        };
                        let rname = newSupply.debugName ?? "<unnamed resource>";
                        let err: any = new Error(
                            `Resource "${rname}" is supplied by two behaviors: ` +
                            `${describe(newSupply.suppliedBy)} and ${describe(behavior)}. ` +
                            `A resource must have exactly one supplying behavior; that behavior is the only place it is updated. ` +
                            `Fix: keep "${rname}" in the behavior that owns that state. In the other behavior replace ` +
                            `.supplies(${rname}) with .demands(${rname}) and read ${rname}.value there, or supply a separate ` +
                            `resource that the owner demands. Do not merge the two behaviors into one; splitting responsibilities ` +
                            `across small behaviors is the intended design.`
                        );
                        err.alreadySupplied = newSupply;
                        err.desiredSupplier = behavior;
                        throw err;
                    }
                    newSupply.suppliedBy = behavior;
                }

                // technically this behavior doesn't need reordering but its subsequents will
                // if they already demand a newly supplied resource
                // setting this to reorder will ensure its subsequents will reorder if needed
                // in the sortDFS code
                if (behavior.orderingState != OrderingState.NeedsOrdering) {
                    behavior.orderingState = OrderingState.NeedsOrdering;
                    this.needsOrdering.push(behavior);
                }

            }
            this.modifiedSupplyBehaviors.length = 0;
        }
    }

    private addUntrackedDemands(sequence: number) {
        if (this.modifiedDemandBehaviors.length > 0) {
            for (let behavior of this.modifiedDemandBehaviors) {
                // don't link demands for behaviors whose extent was removed after the modification
                if (behavior.extent.addedToGraphWhen == null) {
                    continue;
                }
                if (behavior.untrackedDemands != null) {
                    for (let demand of behavior.untrackedDemands) {
                        if (this.validateLifetimes && !behavior.extent.hasCompatibleLifetime(demand.resource.extent)) {
                            let err: any = new Error(lifetimeMessage("demands", demand.resource, behavior, isChildLifetime(behavior.extent, demand.resource.extent)));
                            err.currentBehavior = behavior;
                            err.demand = demand.resource;
                            throw err;
                        }
                    }
                }
                let allLinks = [...(behavior.untrackedDemands ?? []), ...(behavior.untrackedDynamicDemands ?? [])];
                // trace links only permit traceValue reads; they are not edges
                let allUntrackedDemands = allLinks.filter(linkable => linkable.type != LinkType.trace);
                let traceDemands: Set<Resource> | null = null;
                for (let linkable of allLinks) {
                    if (linkable.type == LinkType.trace) {
                        if (linkable.resource.extent.addedToGraphWhen == null) {
                            let err: any = new Error(demandNotAddedMessage(linkable.resource, behavior));
                            err.currentBehavior = behavior;
                            err.untrackedDemand = linkable.resource;
                            throw err;
                        }
                        if (traceDemands == null) {
                            traceDemands = new Set();
                        }
                        traceDemands.add(linkable.resource);
                    }
                }
                behavior.traceDemands = traceDemands;

                let removedDemands: Resource[] | undefined;
                if (behavior.demands != null) {
                    for (let demand of behavior.demands) {
                        if (!allUntrackedDemands.some(linkable => linkable.resource == demand)) {
                            if (removedDemands == undefined) {
                                removedDemands = [];
                            }
                            removedDemands.push(demand);
                        }
                    }
                }

                let addedDemands: Resource[] | undefined;
                for (let linkableDemand of allUntrackedDemands) {
                    let untrackedDemand = linkableDemand.resource;
                    if (untrackedDemand.extent.addedToGraphWhen == null) {
                        let err: any = new Error(demandNotAddedMessage(untrackedDemand, behavior));
                        err.currentBehavior = behavior;
                        err.untrackedDemand = untrackedDemand;
                        throw err;
                    }
                    if (behavior.demands == null || !behavior.demands.has(untrackedDemand)) {
                        if (addedDemands == undefined) {
                            addedDemands = [];
                        }
                        addedDemands.push(untrackedDemand);
                    }
                }

                let needsRunning = false;

                if (removedDemands != undefined) {
                    for (let demand of removedDemands) {
                        demand.subsequents.delete(behavior);
                    }
                }

                let orderBehavior = behavior.orderingState != OrderingState.Ordered;

                if (addedDemands != undefined) {
                    for (let demand of addedDemands) {
                        demand.subsequents.add(behavior);
                        if (demand.justUpdated) {
                            needsRunning = true;
                        }
                        if (!orderBehavior) {
                            let prior = demand.suppliedBy;
                            if (prior != null && prior.orderingState == OrderingState.Ordered && prior.order >= behavior.order) {
                                orderBehavior = true;
                            }
                        }
                    }
                }

                let newDemands: Set<Resource> | null = null;
                let orderingDemands: Set<Resource> | null = null;
                for (let linkable of allUntrackedDemands) {
                    if (newDemands == null) {
                        newDemands = new Set();
                    }
                    newDemands.add(linkable.resource);
                    if (linkable.type == LinkType.order) {
                        if (orderingDemands == null) {
                            orderingDemands = new Set();
                        }
                        orderingDemands.add(linkable.resource);
                    }
                }
                behavior.demands = newDemands;
                behavior.orderingDemands = orderingDemands;

                if (orderBehavior) {
                    if (behavior.orderingState != OrderingState.NeedsOrdering) {
                        behavior.orderingState = OrderingState.NeedsOrdering;
                        this.needsOrdering.push(behavior);
                    }
                }
                if (needsRunning) {
                    this.activateBehavior(behavior, sequence);
                }


            }
            this.modifiedDemandBehaviors.length = 0;
        }
    }

    private orderBehaviors() {
        // find all behaviors that need ordering and their
        // subsequents and mark them all as needing ordering

        if (this.needsOrdering.length == 0) {
            return;
        }

        let localNeedsOrdering: Behavior[] = [];

        // dfs forward on each to find all that need ordering
        let x = 0;
        while (x < this.needsOrdering.length) {
            let behavior = this.needsOrdering[x];
            if (behavior.orderingState == OrderingState.NeedsOrdering) {
                behavior.orderingState = OrderingState.Clearing;
                localNeedsOrdering.push(behavior);
                if (behavior.supplies) {
                    for (let supply of behavior.supplies) {
                        for (let subsequent of supply.subsequents) {
                            if (subsequent.orderingState == OrderingState.Ordered) {
                                subsequent.orderingState = OrderingState.NeedsOrdering;
                                this.needsOrdering.push(subsequent);
                            }
                        }
                    }
                }
            }
            x++;
        }
        this.needsOrdering.length = 0;

        let needsReheap = {value: false}; // this allows out parameter
        for (let behavior of localNeedsOrdering) {
            this.sortDFS(behavior, needsReheap);
        }

        if (needsReheap.value) {
            this.activatedBehaviors.unsort()
        }
    }

    private sortDFS(behavior: Behavior, needsReheap: { value: boolean }) {
        if (behavior.orderingState == OrderingState.Ordering) {
            let cycle = this.debugCycleForBehavior(behavior);
            let err: any = new Error(cycleMessage(behavior, cycle));
            err.currentBehavior = behavior;
            err.cycle = cycle;
            throw err;
        }

        if (behavior.orderingState == OrderingState.Clearing) {
            behavior.orderingState = OrderingState.Ordering;

            let order = 0;
            if (behavior.demands != null) {
                for (let demand of behavior.demands) {
                    let prior = demand.suppliedBy;
                    if (prior != null) {
                        if (prior.orderingState != OrderingState.Ordered) {
                            this.sortDFS(prior, needsReheap);
                        }
                        order = Math.max(order, prior.order + 1);
                    }
                }
            }

            behavior.orderingState = OrderingState.Ordered;

            if (order != behavior.order) {
                behavior.order = order;
                needsReheap.value = true;
            }
        }
    }

    private reprioritize() {
        // Links changed, so every cached height may be stale. Recompute lazily for activated
        // behaviors now and for later activations as they happen.
        this.linksChanged = false;
        this.heightGeneration++;
        this.activatedBehaviors.unsort();
        for (let behavior of this.activatedBehaviors.buffer) {
            behavior.priority = -this.heightOf(behavior);
        }
    }

    // The longest path from `behavior` to a sink. Reverse mode ranks by its negative: for every
    // edge A -> B, A's path is longer than B's, so A still runs first, and unrelated behaviors
    // run as late as their dependents allow.
    private heightOf(behavior: Behavior): number {
        if (behavior.priorityGeneration == this.heightGeneration) {
            return -behavior.priority;
        }
        // mark before descending; the graph is acyclic once ordered, this only guards recursion
        behavior.priorityGeneration = this.heightGeneration;
        behavior.priority = 0;
        let height = 0;
        if (behavior.supplies != null) {
            for (let supply of behavior.supplies) {
                for (let subsequent of supply.subsequents) {
                    height = Math.max(height, this.heightOf(subsequent) + 1);
                }
            }
        }
        behavior.priority = -height;
        return height;
    }

    /** The resources on a dependency cycle through `behavior`, or an empty array if there is none. */
    debugCycleForBehavior(behavior: Behavior): Resource[] {
        let stack: Resource[] = [];
        let output: Resource[] = [];
        if (this.cycleDFS(behavior, behavior, stack)) {
            output = stack;
        }
        return output;
    }

    private cycleDFS(currentBehavior: Behavior, target: Behavior, stack: Resource[]): boolean {
        if (currentBehavior.demands != null) {
            for (let r of currentBehavior.demands) {
                let b = r.suppliedBy;
                if (b != null) {
                    stack.push(r)
                    if (b == target) {
                        return true;
                    }
                    if (this.cycleDFS(b, target, stack)) {
                        return true;
                    }
                    stack.pop();
                }
            }
        }
        return false;
    }

    /** @internal */
    addBehavior(behavior: Behavior) {
        this.untrackedBehaviors.push(behavior)
    }

    /** @internal */
    updateDemands(behavior: Behavior, newDemands: Demandable[] | null) {
        if (behavior.extent.addedToGraphWhen == null) {
            let err: any = new Error("Behavior must belong to graph before updating demands.");
            err.behavior = behavior;
            throw err;
        } else if (this.currentEvent == null) {
            let err: any = new Error("Demands can only be updated during an event.");
            err.behavior = behavior;
            throw err;
        }
        behavior.untrackedDynamicDemands = newDemands;
        this.modifiedDemandBehaviors.push(behavior);
    }

    /** @internal */
    updateSupplies(behavior: Behavior, newSupplies: Resource[] | null) {
        if (behavior.extent.addedToGraphWhen == null) {
            let err: any = new Error("Behavior must belong to graph before updating supplies.");
            err.behavior = behavior;
            throw err;
        } else if (this.currentEvent == null) {
            let err: any = new Error("Supplies can only be updated during an event.");
            err.behavior = behavior;
            throw err;
        }
        behavior.untrackedDynamicSupplies = newSupplies;
        this.modifiedSupplyBehaviors.push(behavior);
    }


    /** @internal */
    removeBehavior(behavior: Behavior, sequence: number) {
        // If we demand a foreign resource then we should be
        // removed from its list of subsequents
        if (behavior.demands != null) {
            let removed = false;
            for (let demand of behavior.demands) {
                if (demand.extent != behavior.extent) {
                    demand.subsequents.delete(behavior);
                    removed = true;
                }
            }
            // and remove foreign demands
            // its faster to erase the whole list than pick out the foreign ones
            if (removed) {
                behavior.demands.clear();
            }
        }

        behavior.traceDemands = null;

        // any foreign resources should no longer be supplied by this behavior
        if (behavior.supplies != null) {
            let removed = false;
            for (let supply of behavior.supplies) {
                if (supply.extent != behavior.extent) {
                    supply.suppliedBy = null;
                    removed = true;
                }
            }
            // and clear out those foreign supplies
            // its faster to clear whole list than pick out individual foreign ones
            if (removed) {
                behavior.supplies.clear();
            }
        }


        behavior.removedWhen = sequence;
        this.linksChanged = true;
    }

    /** @internal */
    addExtent(extent: Extent) {
        if (extent.addedToGraphWhen != null) {
            let err: any = new Error("Extent already belongs to a graph.");
            err.extent = extent;
            err.graph = this;
            throw err;
        }
        if (this.currentEvent == null) {
            let err: any = new Error("Extents can only be added during an event.");
            err.extent = extent;
            throw err;
        }

        if (this.validateLifetimes) {
            if (extent.lifetime != null) {
                if (extent.lifetime.addedToGraphWhen == null) {
                    // first extent in lifetime being added
                    extent.lifetime.addedToGraphWhen = this.currentEvent.sequence;
                }
                if (extent.lifetime.parent != null) {
                    if (extent.lifetime.parent.addedToGraphWhen == null) {
                        let err: any = new Error("Extent with child lifetime must be added after parent.");
                        err.extent = extent;
                        throw err;
                    }
                }
            }
        }

        extent.addedToGraphWhen = this.currentEvent.sequence;
        extent.removedFromGraphWhen = null;
        this.extentsAdded.push(extent);
        // this casting below is a hack to get at the private method so we can skip integrity checks which
        // allow us to update addedToGraph from inside whatever behavior or action it is added
        (extent.addedToGraph as unknown as StateInternal<boolean>)._updateForce(true);
        for (let behavior of extent.behaviors) {
            this.addBehavior(behavior);
        }
    }

    /** @internal */
    removeExtent(extent: Extent) {
        if (this.currentEvent == null) {
            let err: any = new Error("Extents can only be removed during an event.");
            err.extent = extent;
            throw err;
        } else {
            this.extentsRemoved.push(extent);
            for (let behavior of extent.behaviors) {
                this.removeBehavior(behavior, this.currentEvent.sequence);
            }
            let cleanups = takeRemovalCleanups(extent);
            if (cleanups != null) {
                // pushed directly rather than through sideEffectHelper, which refuses
                // while side effects are running
                this.effects.push({block: cleanups, extent: extent, behavior: this.currentBehavior, debugName: "removal cleanups"});
            }
            extent.addedToGraphWhen = null;
            extent.removedFromGraphWhen = this.currentEvent.sequence;
            // same private access hack as addExtent to skip integrity checks
            (extent.addedToGraph as unknown as StateInternal<boolean>)._updateForce(false);
        }
    }
}

enum EventLoopPhase {
    queued,
    action,
    updates,
    sideEffects
}

/** @internal */
export class EventLoopState {
    action: Action;
    actionUpdates: Resource[];
    currentSideEffect: SideEffect | null = null;
    phase: EventLoopPhase;

    constructor(action: Action) {
        this.action = action;
        this.phase = EventLoopPhase.queued;
        this.actionUpdates = [];
    }
}
