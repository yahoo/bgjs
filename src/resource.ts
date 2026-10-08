//
//  Copyright Yahoo 2021
//


import {accessMessage, traceAccessMessage, unsuppliedInBehaviorMessage, updateOutsideMessage, wrongSupplierMessage} from "./errors.js";
import {Behavior} from "./behavior.js";
import {Extent} from "./extent.js";
import {Graph} from "./graph.js";
import {GraphEvent, Subscription, Transient} from "./common.js";

export enum LinkType {
    reactive,
    order,
    // Declares a read of the value from before this event (traceValue). Not an ordering edge.
    trace,
}

/** Anything a behavior can demand: a resource, `resource.order`, or `state.trace`. */
export interface Demandable {
    resource: Resource,
    type: LinkType
}

/**
 * A node in the graph that behaviors demand and supply. A plain Resource has no value and is
 * used for ordering; {@link State} and {@link Moment} carry values. Create them with
 * `extent.resource()`, `extent.state()` and `extent.moment()`.
 */
export class Resource implements Demandable {
    /** The field name on its extent (set when the extent is added) or the name passed at creation. */
    debugName: string | null;
    /** @internal */
    isResource: boolean = true;
    /** The extent that owns this resource. */
    extent: Extent;
    /** The graph of the owning extent. */
    graph: Graph;
    /** The behaviors that demand this resource. */
    subsequents: Set<Behavior> = new Set();
    /** The behavior that supplies this resource, or null if only actions update it. */
    suppliedBy: Behavior | null = null;
    /** @internal */
    skipChecks: boolean = false;
    /** @internal */
    didUpdateSubscribers?: Set<Subscription>;

    constructor(extent: Extent, name?: string) {
        this.extent = extent;
        this.graph = extent.graph;
        extent.addResource(this);
        if (name !== undefined) {
            this.debugName = name;
        } else {
            this.debugName = null;
        }
    }

    /** An ordering-only demand: the behavior runs after this resource's supplier and may read it, but does not run when it updates. Still an edge, so it can form cycles. */
    get order(): Demandable {
        return {resource: this, type: LinkType.order }
    }

    /** This resource (part of {@link Demandable}). */
    get resource(): Resource {
        return this;
    }

    /** The link type of a plain demand (part of {@link Demandable}). */
    get type(): LinkType {
        return LinkType.reactive;
    }

    toString() {
        let name = "Resource";
        if (this.debugName != null) {
            name = this.debugName + "(r)";
        }
        return name;
    }

    // Updates to resources of removed extents are ignored. Queued actions (e.g. UI events)
    // may still fire after their extent has been removed; those updates should do nothing.
    protected get isExtentRemoved(): boolean {
        return this.extent.removedFromGraphWhen != null;
    }

    /** @internal */
    assertValidUpdater() {
        let graph = this.graph;
        let currentBehavior = graph.currentBehavior;
        let currentEvent = graph.currentEvent;
        if (currentBehavior == null && currentEvent == null) {
            let err: any = new Error(updateOutsideMessage(this));
            err.resource = this;
            throw err;
        }
        if (this.skipChecks) { return; }
        if (this.suppliedBy && currentBehavior != this.suppliedBy) {
            let err: any = new Error(wrongSupplierMessage(this, currentBehavior));
            err.resource = this;
            err.currentBehavior = currentBehavior;
            throw err;
        }
        if (this.suppliedBy == null && currentBehavior != null) {
            let err: any = new Error(unsuppliedInBehaviorMessage(this, currentBehavior));
            err.resource = this;
            err.currentBehavior = currentBehavior;
            throw err;
        }
    }

    /** @internal */
    assertValidAccessor() {
        let graph = this.graph;
        let currentBehavior = graph.currentBehavior;

        if (currentBehavior != null && currentBehavior != this.suppliedBy && !currentBehavior.demands?.has(this)) {
            let err: any = new Error(accessMessage(this, currentBehavior));
            err.resource = this;
            err.currentBehavior = currentBehavior;
            throw err;
        }
    }

    /** Always false on a plain Resource; see State and Moment. */
    get justUpdated(): boolean {
        this.assertValidAccessor();
        return false;
    }

    /** Runs `callback` as a side effect at the end of any event in which this resource updated. Returns an unsubscribe function. */
    subscribeToJustUpdated(callback: () => void): (() => void) {
        return this._subscribeToJustUpdated({extent: null, callback: callback})
    }

    /** @internal */
    _subscribeToJustUpdated(subscription: Subscription): (() => void) {
        // returns an unsubscribe callback that caller can call when no longer needed
        if (this.didUpdateSubscribers === undefined) {
            this.didUpdateSubscribers = new Set();
        }
        this.didUpdateSubscribers!.add(subscription);
        return (() => {
            this.didUpdateSubscribers!.delete(subscription);
        });
    }

    protected notifyJustUpdatedSubscribers() {
        if (this.didUpdateSubscribers !== undefined && this.didUpdateSubscribers.size > 0) {
            this.graph._notifyJustUpdatedSubscribers(this.didUpdateSubscribers!);
        }
    }
}

/**
 * Something that happened in the current event, optionally with a payload of type T. It is
 * `justUpdated` for exactly one event and then resets. Use it for inputs, timer fires and
 * replies. Copy a payload into a {@link State} if it must outlast the event.
 */
export class Moment<T = undefined> extends Resource implements Transient {
    private _happened: boolean = false;
    private _happenedValue: T | undefined = undefined;
    private _happenedWhen: GraphEvent | null = null;

    /** True only during the event in which this moment was updated. Requires a demand or supply when read in a behavior. */
    get justUpdated(): boolean {
        this.assertValidAccessor();
        return this._happened;
    }

    /** The payload during the event it was updated; undefined afterwards. */
    get value(): T | undefined {
        this.assertValidAccessor();
        return this._happenedValue;
    }

    /** The event in which this moment was last updated, or null if never. */
    get event(): GraphEvent | null {
        this.assertValidAccessor();
        return this._happenedWhen;
    }

    toString() {
        let name = "Moment";
        if (this.debugName != null) {
            name = (this.debugName + "(m)" )
        }
        if (this._happenedValue !== undefined) {
            name = name + "=" + this._happenedValue;
        }
        if (this._happenedWhen !== null) {
            name = name + " : " + this._happenedWhen!.sequence
        }
        return name;
    }

    /** True if this moment was updated in this event with a payload `==` to `value`. */
    justUpdatedTo(value: T): boolean {
        return this.justUpdated && this._happenedValue == value;
    }

    /** Updates this moment in a new action. Use it from outside code, timers and callbacks. */
    updateWithAction(value: T | undefined = undefined, debugName?: string) {
        this.graph.action(() => {
            this.update(value);
        }, debugName);
        return;
    }

    /** Marks this moment as happened in this event. Only in an action (if no behavior supplies it) or in its supplying behavior. */
    update(value: T | undefined = undefined) {
        if (this.isExtentRemoved) { return; }
        this.assertValidUpdater();
        this._happened = true;
        this._happenedValue = value;
        this._happenedWhen = this.graph.currentEvent;
        this.notifyJustUpdatedSubscribers();
        this.graph.resourceTouched(this);
        this.graph.trackTransient(this);
    }

    /** Internal: called by the graph at the end of each event. */
    clear(): void {
        this._happened = false;
        this._happenedValue = undefined;
    }

}

export type StateHistory<T> = { value: T, event: GraphEvent };
/**
 * A value that persists across events. It remembers the event in which it last changed, so a
 * behavior can ask whether it changed in this event (`justUpdated`) and what it was before
 * (`traceValue`). `update` compares with `===`.
 */
export class State<T> extends Resource implements Transient {
    private currentState: StateHistory<T>;
    private previousState: StateHistory<T> | null = null;

    constructor(extent: Extent, initialState: T, name?: string) {
        super(extent, name);
        this.currentState = { value: initialState, event: GraphEvent.initialEvent };
    }

    toString() {
        let name = "State";
        if (this.debugName != null) {
            name = (this.debugName + "(s)" );
        }
        name = name + "=" + this.currentState.value;
        name = name + " : " + this.currentState.event.sequence;
        return name;
    }

    /** Updates this state in a new action. Use it from outside code, timers and callbacks. */
    updateWithAction(newValue: T, debugName?: string) {
        this.graph.action(() => {
            this.update(newValue);
        }, debugName);
        return;
    }

    /** Sets the value, unless it is `===` to the current one (then nothing happens). Only in an action (if no behavior supplies it) or in its supplying behavior. */
    update(newValue: T) {
        if (this.currentState.value === newValue) {
            return;
        }
        this.updateForce(newValue);
    }

    /** Like `update`, but marks the state updated even if the value is `===` to the current one. */
    updateForce(newValue: T) {
        if (this.isExtentRemoved) { return; }
        this.assertValidUpdater();
        this._updateForce(newValue);
    }

    private _updateForce(newValue: T) {
        if (this.graph.currentEvent != null && this.currentState.event.sequence < this.graph.currentEvent?.sequence) {
            // captures trace as the value before any updates
            this.previousState = this.currentState;
        }

        this.currentState = { value: newValue, event: this.graph.currentEvent! };

        this.notifyJustUpdatedSubscribers();

        this.graph.resourceTouched(this);
        this.graph.trackTransient(this);
    }

    /** Internal: called by the graph at the end of each event. */
    clear(): void {
        this.previousState = null;
    }

    /** The current value. Inside a behavior, requires a demand (plain or `.order`) or supply. */
    get value(): T {
        this.assertValidAccessor();
        return this.currentState.value;
    }

    /** The event in which the value last changed; sequence 0 for the initial value. */
    get event(): GraphEvent {
        this.assertValidAccessor();
        return this.currentState.event;
    }

    private get history(): StateHistory<T> {
        if (this.currentState.event === this.graph.currentEvent) {
            return this.previousState!;
        } else {
            return this.currentState;
        }
    }

    /** A trace demand: lets a behavior read `traceValue` and `traceEvent` but not `value`. Not an edge, so it never orders or activates the behavior and cannot form a cycle. */
    get trace(): Demandable {
        return {resource: this, type: LinkType.trace};
    }

    // Inside a behavior, traceValue may be read only by the supplier, a behavior that demands
    // this state, or one that declares this.trace in its demands.
    /** @internal */
    assertValidTraceAccessor() {
        let currentBehavior = this.graph.currentBehavior;
        if (currentBehavior != null && this.graph.validateTraceDemands && currentBehavior != this.suppliedBy &&
            !currentBehavior.demands?.has(this) && !currentBehavior.traceDemands?.has(this)) {
            let err: any = new Error(traceAccessMessage(this, currentBehavior));
            err.resource = this;
            err.currentBehavior = currentBehavior;
            throw err;
        }
    }

    /** The value at the start of the current event (the current value outside events). Inside a behavior, requires a demand, supply, or `.trace` demand. */
    get traceValue(): T {
        this.assertValidTraceAccessor();
        return this.history.value;
    }

    /** The event of the value returned by `traceValue`. */
    get traceEvent(): GraphEvent {
        this.assertValidTraceAccessor();
        return this.history.event;
    }

    /** True if the value changed in the current event. */
    get justUpdated(): boolean {
        this.assertValidAccessor();
        return this.currentState.event === this.graph.currentEvent
    }

    /** True if the value changed in this event to `toState`. */
    justUpdatedTo(toState: T): boolean {
        return this.justUpdated && this.currentState.value == toState;
    }

    /** True if the value changed in this event from `fromState`. */
    justUpdatedFrom(fromState: T): boolean {
        return this.justUpdated && this.history.value == fromState;
    }

    /** True if the value changed in this event from `fromState` to `toState`. */
    justUpdatedToFrom(toState: T, fromState: T): boolean {
        return this.justUpdatedTo(toState) && this.justUpdatedFrom(fromState);
    }
}

