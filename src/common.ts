import {Extent} from "./extent";

export enum OrderingState {
    Untracked, // new behaviors
    NeedsOrdering, // added to list for ordering
    Clearing, // visited while clearing dfs
    Ordering, // visited while ordering dfs
    Ordered // has a valid order
}

export interface DateProvider {
    now(): Date
}

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
}

export class ActionMoment {
    sequence: number;
    timestamp: Date;
    static readonly initialEvent: ActionMoment = new ActionMoment(0, new Date(0));

    constructor(sequence: number, timestamp: Date) {
        this.sequence = sequence;
        this.timestamp = timestamp;
    }
}

/**
 * @deprecated Legacy name. Use ActionMoment instead.
 * This alias will be removed in a future version.
 */
export type GraphEvent = ActionMoment;

export interface Transient {
    clear(): void;
}

export interface Subscription {
    extent: Extent | null;
    callback: (extent: Extent | null) => void;
}

