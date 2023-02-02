//
//  Copyright Yahoo 2021
//


import {BufferedPriorityQueue} from "./bufferedqueue.js";
import {Behavior} from "./behavior.js";
import {Extent} from "./extent.js";
import {Demandable, LinkType, Resource} from "./resource.js";

interface StateInternal<T> {
    _updateForce(newValue: T): void;
}

export enum OrderingState {
    Untracked, // new behaviors
    NeedsOrdering, // added to list for ordering
    Clearing, // visited while clearing dfs
    Ordering, // visited while ordering dfs
    Ordered // has a valid order
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
    debugName?: string;
}

export interface DateProvider {
    now(): Date
}

const DefaultDateProvider = {
    now: () => {
        return new Date();
    }
}

export class Graph {
    dateProvider: DateProvider = DefaultDateProvider;
    currentEvent: GraphEvent | null = null;
    lastEvent: GraphEvent;
    activatedBehaviors: BufferedPriorityQueue<Behavior> = new BufferedPriorityQueue();
    currentBehavior: Behavior | null = null;
    effects: SideEffect[] = [];
    actions: Action[] = [];
    untrackedBehaviors: Behavior[] = [];
    modifiedDemandBehaviors: Behavior[] = [];
    modifiedSupplyBehaviors: Behavior[] = [];
    updatedTransients: Transient[] = [];
    needsOrdering: Behavior[] = [];
    eventLoopState: EventLoopState | null = null;
    extentsAdded: Extent[] = [];
    extentsRemoved: Extent[] = [];
    validateLifetimes: boolean = true;

    constructor() {
        this.lastEvent = GraphEvent.initialEvent;
    }

    action(block: () => void, debugName?: string) {
        this.actionHelper({debugName: debugName, block: block, extent: null, resolve: null});
    }

    actionHelper(action: Action) {
        if (this.eventLoopState != null && (this.eventLoopState.phase == EventLoopPhase.action || this.eventLoopState.phase == EventLoopPhase.updates)) {
            let err: any = new Error("Action cannot be created directly inside another action or behavior. Consider wrapping it in a side effect block.");
            throw err;
        }
        this.actions.push(action);
        this.eventLoop();
    }

    async actionAsync(block: () => void, debugName?: string) {
        return this.actionAsyncHelper({debugName: debugName, block: block, extent: null, resolve: null})
    }

    async actionAsyncHelper(action: Action) {
        return new Promise((resolve, reject) => {
            try {
                if (this.eventLoopState != null && (this.eventLoopState.phase == EventLoopPhase.action || this.eventLoopState.phase == EventLoopPhase.updates)) {
                    let err: any = new Error("Action cannot be created directly inside another action or behavior. Consider wrapping it in a side effect block.");
                    throw err;
                }
                action.resolve = resolve;
                this.actions.push(action);
                if (this.currentEvent == null) {
                    this.eventLoop();
                }
            } catch (e) {
                reject(e);
            }
        });
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
                    this.addUntrackedBehaviors();
                    this.addUntrackedSupplies();
                    this.addUntrackedDemands(sequence);
                    this.orderBehaviors();
                    this.runNextBehavior(sequence);

                    continue;
                }

                if (this.validateLifetimes) {
                    if (this.extentsAdded.length > 0) {
                        this.validateAddedExtents();
                        this.extentsAdded.length = 0;
                    }
                    if (this.extentsRemoved.length > 0) {
                        this.validateRemovedExtents();
                        this.extentsRemoved.length = 0;
                    }
                }

                let effect = this.effects.shift();
                if (effect) {
                    this.eventLoopState!.phase = EventLoopPhase.sideEffects;
                    this.eventLoopState!.currentSideEffect = effect;
                    effect.block(effect.extent);
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
                    action.block(action.extent);
                    continue;
                }

            } catch (error) {
                this.currentEvent = null;
                this.eventLoopState = null;
                this.actions.length = 0;
                this.effects.length = 0;
                this.currentBehavior = null;
                this.activatedBehaviors.clear();
                this.clearTransients();
                this.modifiedDemandBehaviors.length = 0;
                this.modifiedSupplyBehaviors.length = 0;
                this.untrackedBehaviors.length = 0;
                this.extentsAdded.length = 0;
                this.extentsRemoved.length = 0;
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
                        let err: any = new Error("Remaining behaviors must remove dynamicDemands to removed resources.");
                        err.remainingBehavior = demandedBy;
                        err.removedResource = resource;
                        throw err;
                    }
                }
                if (resource.suppliedBy != null && resource.suppliedBy.extent.addedToGraphWhen != null) {
                    let err: any = new Error("Remaining behaviors must remove dynamicSupplies to removed resources.");
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

    trackTransient(resource: Transient) {
        this.updatedTransients.push(resource);
    }

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
            this.activatedBehaviors.push(behavior);
        }
    }

    private runNextBehavior(sequence: number) {
        // take top behavior off queue
        let topBehavior = this.activatedBehaviors.pop();
        // if no behavior left we quit
        while (topBehavior !== undefined) {
            if (topBehavior!.removedWhen == sequence) {
                // if this behavior has been removed already then try next one
                topBehavior = this.activatedBehaviors.pop();
            } else {
                // valid behavior, run it
                this.currentBehavior = topBehavior!;
                topBehavior!.block(topBehavior!.extent);
                this.currentBehavior = null;
                // check if there is a next behavior and it's the same ordering as the first behavior
                let nextBehavior = this.activatedBehaviors.peek();
                if (nextBehavior !== undefined && nextBehavior!.order == topBehavior!.order) {
                    // if so we will try running it also
                    topBehavior = this.activatedBehaviors.pop();
                } else {
                    break;
                }
            }
        }
    }

    sideEffect(block: () => void, debugName?: string) {
        this.sideEffectHelper({debugName: debugName, block: block, behavior: null, extent: null});
    }

    sideEffectHelper(sideEffect: SideEffect) {
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
                this.modifiedDemandBehaviors.push(behavior);
                this.modifiedSupplyBehaviors.push(behavior);
            }
            this.untrackedBehaviors = [];
        }
    }

    private addUntrackedSupplies() {
        if (this.modifiedSupplyBehaviors.length > 0) {
            for (let behavior of this.modifiedSupplyBehaviors) {
                if (behavior.untrackedSupplies != null) {
                    for (let supply of behavior.untrackedSupplies) {
                        if (this.validateLifetimes && !behavior.extent.hasCompatibleLifetime(supply.extent)) {
                            let err: any = new Error("Static supplies can only be with extents with the unified or parent lifetimes.");
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
                        let err: any = new Error("Resource cannot be supplied by more than one behavior.");
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
                if (behavior.untrackedDemands != null) {
                    for (let demand of behavior.untrackedDemands) {
                        if (this.validateLifetimes && !behavior.extent.hasCompatibleLifetime(demand.resource.extent)) {
                            let err: any = new Error("Static demands can only be with extents with the unified or parent lifetimes.");
                            err.currentBehavior = behavior;
                            err.demand = demand.resource;
                            throw err;
                        }
                    }
                }
                let allUntrackedDemands = [...(behavior.untrackedDemands ?? []), ...(behavior.untrackedDynamicDemands ?? [])];

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
                        let err: any = new Error("All demands must be added to the graph.");
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
            let err: any = new Error("Behavior dependency cycle detected.");
            err.currentBehavior = behavior;
            err.cycle = this.debugCycleForBehavior(behavior);
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

    debugCycleForBehavior(behavior: Behavior): Resource[] {
        let stack: Resource[] = [];
        let output: Resource[] = [];
        if (this.cycleDFS(behavior, behavior, stack)) {
            output = stack;
            // while (stack.length > 0) {
            //     let rez = stack.pop();
            //     output.push(rez!);
            // }
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

    addBehavior(behavior: Behavior) {
        this.untrackedBehaviors.push(behavior)
    }

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
    }

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
        this.extentsAdded.push(extent);
        // this casting below is a hack to get at the private method so we can skip integrity checks which
        // allow us to update addedToGraph from inside whatever behavior or action it is added
        (extent.addedToGraph as unknown as StateInternal<boolean>)._updateForce(true);
        for (let behavior of extent.behaviors) {
            this.addBehavior(behavior);
        }
    }

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
            extent.addedToGraphWhen = null;
        }
    }
}

export class GraphEvent {
    sequence: number;
    timestamp: Date;
    static readonly initialEvent: GraphEvent = new GraphEvent(0, new Date(0));

    constructor(sequence: number, timestamp: Date) {
        this.sequence = sequence;
        this.timestamp = timestamp;
    }
}

enum EventLoopPhase {
    queued,
    action,
    updates,
    sideEffects
}

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

export interface Transient {
    clear(): void;
}

