import * as bg from "behavior-graph";

export interface Message {
    type: string;
}

export class InitMessage implements Message {
    type: string = "init";
}

export class InitResponseMessage implements Message {
    type: string = "init-response";
}

export class ListGraphs implements Message {
    type: string = "list-graphs";
}

export type GraphSpec = {
    id: number;
    debugName: string;
}

export class AllGraphs implements Message {
    type: string = "all-graphs";
    graphs: GraphSpec[];

    constructor(allGraphs: GraphSpec[]) {
        this.graphs = allGraphs;
    }
}

export class GraphDetails implements Message {
    type: string = "graph-details";
    graphId: number;

    constructor(graphId: number) {
        this.graphId = graphId;
    }
}

export type ActionSpec = {
    debugName: string|null;
    updates: ResourceSpec[];
}

export type SideEffectSpec = {
    debugName: string|null;
}

export type EventSpec = {
    sequence: number;
    timestamp: Date;
}

export type ResourceSpec = {
    graphId: number;
    extentId: number;
    resourceId: number;
    type: string;
    debugName: string|null;
    value: any;
    updated: number|null;
    suppliedBy: BehaviorShortSpec;
    demandedBy: BehaviorLinkSpec[];
}

export type DemandLinkSpec = {
    linkType: string;
    resource: ResourceSpec;
}

export type BehaviorLinkSpec = {
    linkType: string;
    behavior: BehaviorShortSpec;
}

export type BehaviorDetailSpec = {
    graphId: number;
    extentId: number;
    behaviorId: number;
    description: string;
    supplies: ResourceSpec[];
    demands: DemandLinkSpec[];
    lastRun: number;
}

export type BehaviorShortSpec = {
    graphId: number;
    extentId: number;
    behaviorId: number;
    supplies: ResourceSpec[];
}

export class GraphDetailsResponse implements Message {
    type: string = "graph-details-response";
    graphId: number;
    actionQueue: ActionSpec[] = [];
    currentAction: ActionSpec | null = null;
    sideEffectQueue: SideEffectSpec[] = [];
    currentSideEffect: SideEffectSpec | null = null;
    currentEvent: EventSpec | null = null;
    lastEvent: EventSpec = {sequence: 0, timestamp: new Date(0)};
    currentBehavior: BehaviorDetailSpec | null = null;
    behaviorQueue: BehaviorShortSpec[] = [];

    constructor(graphId: number) {
        this.graphId = graphId;
    }
}