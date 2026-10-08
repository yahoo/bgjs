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

export interface Demandable {
    resource: Resource,
    type: LinkType
}

export class Resource implements Demandable {
    debugName: string | null;
    isResource: boolean = true;
    extent: Extent;
    graph: Graph;
    subsequents: Set<Behavior> = new Set();
    suppliedBy: Behavior | null = null;
    skipChecks: boolean = false;
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

    get order(): Demandable {
        return {resource: this, type: LinkType.order }
    }

    get resource(): Resource {
        return this;
    }

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

    get justUpdated(): boolean {
        this.assertValidAccessor();
        return false;
    }

    subscribeToJustUpdated(callback: () => void): (() => void) {
        return this._subscribeToJustUpdated({extent: null, callback: callback})
    }

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

export class Moment<T = undefined> extends Resource implements Transient {
    private _happened: boolean = false;
    private _happenedValue: T | undefined = undefined;
    private _happenedWhen: GraphEvent | null = null;

    get justUpdated(): boolean {
        this.assertValidAccessor();
        return this._happened;
    }

    get value(): T | undefined {
        this.assertValidAccessor();
        return this._happenedValue;
    }

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

    justUpdatedTo(value: T): boolean {
        return this.justUpdated && this._happenedValue == value;
    }

    updateWithAction(value: T | undefined = undefined, debugName?: string) {
        this.graph.action(() => {
            this.update(value);
        }, debugName);
        return;
    }

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

    clear(): void {
        this._happened = false;
        this._happenedValue = undefined;
    }

}

export type StateHistory<T> = { value: T, event: GraphEvent };
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

    updateWithAction(newValue: T, debugName?: string) {
        this.graph.action(() => {
            this.update(newValue);
        }, debugName);
        return;
    }

    update(newValue: T) {
        if (this.currentState.value === newValue) {
            return;
        }
        this.updateForce(newValue);
    }

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

    clear(): void {
        this.previousState = null;
    }

    get value(): T {
        this.assertValidAccessor();
        return this.currentState.value;
    }

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

    // Demand this to read traceValue without ordering on this state:
    // .demands(this.a, this.b.trace). It never forms a cycle and never activates the behavior.
    get trace(): Demandable {
        return {resource: this, type: LinkType.trace};
    }

    // Inside a behavior, traceValue may be read only by the supplier, a behavior that demands
    // this state, or one that declares this.trace in its demands.
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

    get traceValue(): T {
        this.assertValidTraceAccessor();
        return this.history.value;
    }

    get traceEvent(): GraphEvent {
        this.assertValidTraceAccessor();
        return this.history.event;
    }

    get justUpdated(): boolean {
        this.assertValidAccessor();
        return this.currentState.event === this.graph.currentEvent
    }

    justUpdatedTo(toState: T): boolean {
        return this.justUpdated && this.currentState.value == toState;
    }

    justUpdatedFrom(fromState: T): boolean {
        return this.justUpdated && this.history.value == fromState;
    }

    justUpdatedToFrom(toState: T, fromState: T): boolean {
        return this.justUpdatedTo(toState) && this.justUpdatedFrom(fromState);
    }
}

