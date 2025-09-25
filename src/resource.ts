//
//  Copyright Yahoo 2021
//


import {Behavior} from "./behavior.js";
import {Extent} from "./extent.js";
import {Graph} from "./graph.js";
import {ActionMoment, Subscription, Transient} from "./common";

export enum LinkType {
    reactive,
    order,
}

export interface Demandable {
    resource: Signal,
    type: LinkType
}

export class Signal implements Demandable {
    debugName: string | null;
    isSignal: boolean = true;
    extent: Extent;
    graph: Graph;
    subsequents: Set<Behavior> = new Set();
    suppliedBy: Behavior | null = null;
    skipChecks: boolean = false;
    didUpdateSubscribers?: Set<Subscription>;

    constructor(extent: Extent, name?: string) {
        this.extent = extent;
        this.graph = extent.graph;
        extent.addSignal(this);
        if (name !== undefined) {
            this.debugName = name;
        } else {
            this.debugName = null;
        }
    }

    get order(): Demandable {
        return {resource: this, type: LinkType.order }
    }

    get resource(): Signal {
        return this;
    }

    get type(): LinkType {
        return LinkType.reactive;
    }

    toString() {
        let name = "Signal";
        if (this.debugName != null) {
            name = this.debugName + "(s)";
        }
        return name;
    }

    assertValidUpdater() {
        let graph = this.graph;
        let currentBehavior = graph.currentBehavior;
        let currentEvent = graph.currentEvent;
        if (currentBehavior == null && currentEvent == null) {
            let err: any = new Error("Resource must be updated inside a behavior or action.");
            err.resource = this;
            throw err;
        }
        if (this.skipChecks) { return; }
        if (this.suppliedBy && currentBehavior != this.suppliedBy) {
            let err: any = new Error("Supplied resource can only be updated by its supplying behavior.");
            err.resource = this;
            err.currentBehavior = currentBehavior;
            throw err;
        }
        if (this.suppliedBy == null && currentBehavior != null) {
            let err: any = new Error("Unsupplied resource can only be updated in an action.");
            err.resource = this;
            err.currentBehavior = currentBehavior;
            throw err;
        }
    }

    assertValidAccessor() {
        let graph = this.graph;
        let currentBehavior = graph.currentBehavior;

        if (currentBehavior != null && currentBehavior != this.suppliedBy && !currentBehavior.demands?.has(this)) {
            let err: any = new Error("Cannot access the value or event of a resource inside a behavior unless it is supplied or demanded.");
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

export class EventSignal<T = undefined> extends Signal implements Transient {
    private _happened: boolean = false;
    private _happenedValue: T | undefined = undefined;
    private _happenedWhen: ActionMoment | null = null;

    get justUpdated(): boolean {
        this.assertValidAccessor();
        return this._happened;
    }

    get value(): T | undefined {
        this.assertValidAccessor();
        return this._happenedValue;
    }

    get moment(): ActionMoment | null {
        this.assertValidAccessor();
        return this._happenedWhen;
    }

    /**
     * @deprecated Use moment instead. This will be removed in a future version.
     */
    get event(): ActionMoment | null {
        this.assertValidAccessor();
        return this._happenedWhen;
    }

    toString() {
        let name = "EventSignal";
        if (this.debugName != null) {
            name = (this.debugName + "(es)" )
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

/**
 * @deprecated Legacy name. Use EventSignal instead.
 * This alias will be removed in a future version.
 */
export type Event<T = undefined> = EventSignal<T>;

/**
 * @deprecated Legacy name for Event signals. Use EventSignal instead.
 * This alias will be removed in a future version.
 */
export type TempEventInternal<T = undefined> = EventSignal<T>;

/**
 * @deprecated Legacy alias for Event signals. Use EventSignal instead.
 * Note: This conflicts with the new ActionMoment class (timestamps), but kept for backwards compatibility.
 */
export type Moment<T = undefined> = EventSignal<T>;

/**
 * @deprecated Temporary alias during terminology migration. Use EventSignal instead.
 * This will be renamed to EventSignal in a future version.
 */
export type TempEvent<T = undefined> = EventSignal<T>;

/**
 * @deprecated Legacy name. Use Signal instead.
 * This alias will be removed in a future version.
 */
export type Resource = Signal;

export type StateHistory<T> = { value: T, event: ActionMoment };
export class StateSignal<T> extends Signal implements Transient {
    private currentState: StateHistory<T>;
    private previousState: StateHistory<T> | null = null;

    constructor(extent: Extent, initialState: T, name?: string) {
        super(extent, name);
        this.currentState = { value: initialState, event: ActionMoment.initialEvent };
    }

    toString() {
        let name = "StateSignal";
        if (this.debugName != null) {
            name = (this.debugName + "(ss)" );
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

    get event(): ActionMoment {
        this.assertValidAccessor();
        return this.currentState.event;
    }

    private get trace(): StateHistory<T> {
        if (this.currentState.event === this.graph.currentEvent) {
            return this.previousState!;
        } else {
            return this.currentState;
        }
    }

    get traceValue(): T {
        return this.trace.value;
    }

    get traceEvent(): ActionMoment {
        return this.trace.event;
    }

    get justUpdated(): boolean {
        this.assertValidAccessor();
        return this.currentState.event === this.graph.currentEvent
    }

    justUpdatedTo(toState: T): boolean {
        return this.justUpdated && this.currentState.value == toState;
    }

    justUpdatedFrom(fromState: T): boolean {
        return this.justUpdated && this.traceValue == fromState;
    }

    justUpdatedToFrom(toState: T, fromState: T): boolean {
        return this.justUpdatedTo(toState) && this.justUpdatedFrom(fromState);
    }
}

/**
 * @deprecated Legacy name. Use StateSignal instead.
 * This alias will be removed in a future version.
 */
export type State<T> = StateSignal<T>;

