//
//  Copyright Yahoo 2021
//


import {Behavior} from "./behavior.js";
import {Extent} from "./extent.js";
import {Graph} from "./graph.js";
import {Moment, Subscription, Transient} from "./common";

export enum LinkType {
    reactive,
    order,
}

export interface Dependable {
    signal: Signal<unknown>,
    type: LinkType
}



export class Signal<T = undefined> implements Dependable, Transient {
    debugName: string | null;
    isSignal: boolean = true;
    extent: Extent;
    graph: Graph;
    subsequents: Set<Behavior> = new Set();
    suppliedBy: Behavior | null = null;
    skipChecks: boolean = false;
    didUpdateSubscribers?: Set<Subscription>;
    
    // Signal value and timestamp properties
    protected _happened: boolean = false;
    protected _happenedValue: T | undefined = undefined;
    protected _happenedWhen: Moment | null = null;

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

    // Dependable interface implementation
    get order(): Dependable {
        return {signal: this, type: LinkType.order }
    }

    get signal(): Signal<unknown> {
        return this;
    }

    get type(): LinkType {
        return LinkType.reactive;
    }

    // Validation methods
    assertValidUpdater() {
        let graph = this.graph;
        let currentBehavior = graph.currentBehavior;
        let currentMoment = graph.currentMoment;
        if (currentBehavior == null && currentMoment == null) {
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

    // Subscription methods
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

    get justUpdated(): boolean {
        this.assertValidAccessor();
        return this._happened;
    }

    get value(): T {
        this.assertValidAccessor();
        return this._happenedValue as T;
    }

    get moment(): Moment | null {
        this.assertValidAccessor();
        return this._happenedWhen;
    }

    toString() {
        let name = "Signal";
        if (this.debugName != null) {
            name = (this.debugName + "(s)" )
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
        return this.justUpdated && this._happenedValue === value;
    }

    // Method overloading for updateWithAction
    updateWithAction(value: T, debugName?: string): void;
    updateWithAction(value?: T extends undefined ? undefined : never, debugName?: string): void;
    updateWithAction(value?: T, debugName?: string): void {
        this.graph.action(() => {
            this.update(value as T);
        }, debugName);
    }

    // Method overloading for update
    update(value: T): void;
    update(value?: T extends undefined ? undefined : never): void;
    update(value?: T): void {
        this.assertValidUpdater();
        this._happened = true;
        this._happenedValue = value;
        this._happenedWhen = this.graph.currentMoment;
        this.notifyJustUpdatedSubscribers();
        this.graph.resourceTouched(this);
        this.graph.trackTransient(this);
    }

    clear(): void {
        this._happened = false;
        // Note: _happenedValue is not meaningful when _happened is false
        // but we need to set it to something for type safety
        this._happenedValue = undefined;
    }

}






export type StateHistory<T> = { value: T, moment: Moment };
export class State<T> extends Signal<T> implements Transient {
    private currentState: StateHistory<T>;
    private previousState: StateHistory<T> | null = null;

    constructor(extent: Extent, initialState: T, name?: string) {
        super(extent, name);
        this.currentState = { value: initialState, moment: Moment.initialEvent };
        // Initialize the Event's value with the initial state
        this._happenedValue = initialState;
        this._happened = false;
    }

    toString() {
        let name = "StateSignal";
        if (this.debugName != null) {
            name = (this.debugName + "(ss)" );
        }
        name = name + "=" + this.currentState.value;
        name = name + " : " + this.currentState.moment.sequence;
        return name;
    }

    // Override with compatible method signature
    updateWithAction(newValue: T, debugName?: string): void;
    updateWithAction(newValue?: T extends undefined ? undefined : never, debugName?: string): void;
    updateWithAction(newValue?: T, debugName?: string): void {
        this.graph.action(() => {
            this.update(newValue as T);
        }, debugName);
    }

    // Override with compatible method signature
    update(newValue: T): void;
    update(newValue?: T extends undefined ? undefined : never): void;
    update(newValue?: T): void {
        if (this.currentState.value === newValue) {
            return;
        }
        this.updateForce(newValue as T);
    }

    updateForce(newValue: T) {
        this.assertValidUpdater();
        this._updateForce(newValue);
    }

    private _updateForce(newValue: T) {
        if (this.graph.currentMoment != null && this.currentState.moment.sequence < this.graph.currentMoment?.sequence) {
            // captures trace as the value before any updates
            this.previousState = this.currentState;
        }

        this.currentState = { value: newValue, moment: this.graph.currentMoment! };

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

    get event(): Moment {
        this.assertValidAccessor();
        return this.currentState.moment;
    }

    private get trace(): StateHistory<T> {
        if (this.currentState.moment === this.graph.currentMoment) {
            return this.previousState!;
        } else {
            return this.currentState;
        }
    }

    get traceValue(): T {
        return this.trace.value;
    }

    get traceEvent(): Moment {
        return this.trace.moment;
    }

    get justUpdated(): boolean {
        this.assertValidAccessor();
        return this.currentState.moment === this.graph.currentMoment
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


