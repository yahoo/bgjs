import {Extent} from "./extent.js";

/** @internal */
export enum OrderingState {
    Untracked, // new behaviors
    NeedsOrdering, // added to list for ordering
    Clearing, // visited while clearing dfs
    Ordering, // visited while ordering dfs
    Ordered // has a valid order
}

/** Supplies event timestamps; see {@link Graph.dateProvider}. */
export interface DateProvider {
    now(): Date
}

/** When a dynamic link is recomputed relative to the behavior running; see {@link BehaviorBuilder.dynamicDemands}. */
export enum RelinkingOrder {
    relinkingOrderPrior,
    relinkingOrderSubsequent
}

export enum RelinkingTarget {
    demand,
    supply
}

export enum ResourceType {
    resource,
    moment,
    typedMoment,
    state,
}

export enum LinkType {
    reactive,
    order,
    trace,
}

/** One run of the event loop, opened by an action. */
export class GraphEvent {
    /** Increases by one per event; 0 before the first. */
    sequence: number;
    /** From {@link Graph.dateProvider} when the event started. */
    timestamp: Date;
    static readonly initialEvent: GraphEvent = new GraphEvent(0, new Date(0));

    constructor(sequence: number, timestamp: Date) {
        this.sequence = sequence;
        this.timestamp = timestamp;
    }
}

/** Internal: resources that reset at the end of an event. */
export interface Transient {
    clear(): void;
}

/** @internal */
export interface Subscription {
    extent: Extent | null;
    callback: (extent: Extent | null) => void;
}

