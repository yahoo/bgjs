//
//  Copyright Yahoo 2021
//


import {Behavior} from "./behavior";
import {Extent, Named} from "./extent";
import {GraphEvent, Graph, Transient, InitialEvent} from "./bggraph";

export enum LinkType {
    demand,
    supply,
    order,
    trace
}

export interface Linkable {
    resource: Resource,
    type: LinkType
}

export class Resource implements Named, Linkable {
    debugName: string | undefined;

    extent: Extent;
    graph: Graph;
    added: boolean = false;
    subsequents: Set<Behavior> = new Set();
    suppliedBy: Behavior | null = null;
    private skipChecks: boolean = false;

    constructor(extent: Extent, name?: string) {
        this.extent = extent;
        this.graph = extent.graph;
        extent.addResource(this);
        if (name !== undefined) {
            this.debugName = name;
        }
    }

    get order(): Linkable {
        return {resource: this, type: LinkType.order }
    }

    get resource(): Resource {
        return this;
    }

    get type(): LinkType {
        return LinkType.demand;
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
        this.currentState = { value: initialState, event: InitialEvent };
    }

    updateWithAction(newValue: T, debugName?: string) {
        this.graph.action(() => {
            this.update(newValue);
        }, debugName);
        return;
    }

    update(newValue: T) {
        if (this.currentState.value == newValue) {
            return;
        }
        this.updateForce(newValue);
    }

    updateForce(newValue: T) {
        this.assertValidUpdater();
        if (this.graph.currentEvent != null && this.currentState.event.sequence < this.graph.currentEvent?.sequence) {
            // captures trace as the value before any updates
            this.previousState = this.currentState;
        }

        this.currentState = { value: newValue, event: this.graph.currentEvent! };
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

    get traceEvent(): GraphEvent {
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

