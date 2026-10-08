//
//  Copyright Yahoo 2021
//


import {Orderable} from "./bufferedqueue.js";
import {Extent} from "./extent.js";
import {Resource, Demandable} from "./resource.js";
import {LinkType, OrderingState, RelinkingOrder} from "./common.js";
import {repeatedDynamicMessage, traceOnlyMessage} from "./errors.js";


/**
 * A block of code together with the resources it demands and supplies. Create one with
 * `extent.behavior()...runs(block)`; the graph runs it in any event in which a demand updated,
 * after the suppliers of its demands. Never call it directly.
 */
export class Behavior implements Orderable {
    /** The resources this behavior is linked to as demands, static and dynamic, including `.order` ones. Null until linked. */
    demands: Set<Resource> | null;
    /** The subset of `demands` that are `.order` demands. */
    orderingDemands: Set<Resource> | null;
    /** The states declared with `.trace`. These are not edges. */
    traceDemands: Set<Resource> | null = null;
    /** The resources this behavior supplies, static and dynamic. Null until linked. */
    supplies: Set<Resource> | null;
    /** @internal */
    block: (extent: Extent) => void;
    /** @internal */
    enqueuedWhen: number | null = null;
    /** @internal */
    removedWhen: number | null = null;
    /** The extent this behavior belongs to. */
    extent: Extent;
    /** @internal */
    orderingState: OrderingState = OrderingState.Untracked;
    /** Topological rank: a behavior runs after every behavior with a lower order that it depends on. */
    order: number = 0;

    /** @internal */
    untrackedDemands: Demandable[] | null;
    /** @internal */
    untrackedDynamicDemands: Demandable[] | null;
    /** @internal */
    untrackedSupplies: Resource[] | null;
    /** @internal */
    untrackedDynamicSupplies: Resource[] | null;

    constructor(extent: Extent, demands: Demandable[] | null, supplies: Resource[] | null, block: (extent: Extent) => void) {
        this.extent = extent;
        extent.addBehavior(this);
        this.demands = null;
        this.orderingDemands = null;
        this.supplies = null;
        this.block = block;
        this.untrackedDemands = demands;
        this.untrackedDynamicDemands = null;
        this.untrackedSupplies = supplies;
        this.untrackedDynamicSupplies = null;
    }

    toString() {
        let name = "Behavior (" + this.order + ")"
        if (this.enqueuedWhen != null) {
            name = name + " : " + this.enqueuedWhen
        }
        if (this.supplies != null && this.supplies?.size > 0) {
            name = name + " \n Supplies:"
            this.supplies?.forEach(item => {
                name = name + "\n  " + item.toString()
            });
        }
        if (this.demands != null && this.demands?.size > 0) {
            name = name + " \n Demands:"
            this.demands?.forEach(item => {
                name = name + "\n  " + item.toString()
            });
        }
        return name;
    }

    /** Replaces this behavior's dynamic demands. Usually done for you by `dynamicDemands` on the builder. */
    setDynamicDemands(newDemands: (Demandable | undefined)[] | null) {
        this.extent.graph.updateDemands(this, newDemands?.filter(item => item != undefined) as (Demandable[] | null));
    }

    /** Replaces this behavior's dynamic supplies. Usually done for you by `dynamicSupplies` on the builder. */
    setDynamicSupplies(newSupplies: (Resource | undefined)[] | null) {
        this.extent.graph.updateSupplies(this, newSupplies?.filter(item => item !== undefined) as (Resource[] | null));
    }

}

/** Builds a {@link Behavior}. Get one from `extent.behavior()` and finish with `runs`. */
export class BehaviorBuilder<T extends Extent> {
    /** @internal */
    extent: T;
    /** @internal */
    untrackedDemands: Demandable[] | null = null;
    /** @internal */
    untrackedSupplies: Resource[] | null = null;
    /** @internal */
    dynamicDemandSwitches: Demandable[] | null = null;
    /** @internal */
    dynamicDemandLinks: ((ext: T) => (Demandable | undefined)[] | null) | null = null;
    /** @internal */
    dynamicDemandRelinkingOrder : RelinkingOrder = RelinkingOrder.relinkingOrderPrior;
    /** @internal */
    dynamicSupplySwitches: Demandable[] | null = null;
    /** @internal */
    dynamicSupplyLinks: ((ext: T) => (Resource | undefined)[] | null) | null = null;
    /** @internal */
    dynamicSupplyRelinkingOrder : RelinkingOrder = RelinkingOrder.relinkingOrderPrior;

    constructor(extent: T) {
        this.extent = extent;
    }

    /**
     * Adds demands: the behavior runs in any event in which one of these updated (except `.order`
     * and `.trace` demands) and may read them. A second call adds to the list.
     */
    demands(...demands: Demandable[]): this {
        this.untrackedDemands = [...(this.untrackedDemands ?? []), ...demands];
        return this;
    }

    /** Adds resources this behavior supplies (is the only one allowed to update). A second call adds to the list. */
    supplies(...supplies: Resource[]): this {
        this.untrackedSupplies = [...(this.untrackedSupplies ?? []), ...supplies];
        return this;
    }

    /**
     * Demands that change at runtime. Whenever a resource in `switches` updates, `links` runs and
     * its result replaces the behavior's dynamic demands. With the default
     * {@link RelinkingOrder.relinkingOrderPrior} the relink happens before the behavior runs; use
     * relinkingOrderSubsequent when the behavior supplies a switch itself. `undefined` entries are
     * dropped. May be called once per behavior.
     */
    dynamicDemands(switches: Demandable[], links: ((ext: T) => (Demandable | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
        if (this.dynamicDemandSwitches != null) {
            let err: any = new Error(repeatedDynamicMessage("dynamicDemands", this.extent));
            err.extent = this.extent;
            throw err;
        }
        this.dynamicDemandSwitches = switches;
        this.dynamicDemandLinks = links;
        if (relinkingOrder != undefined) {
            this.dynamicDemandRelinkingOrder = relinkingOrder;
        }
        return this;
    }

    /**
     * Supplies that change at runtime, relinked like {@link BehaviorBuilder.dynamicDemands}. May
     * be called once per behavior.
     */
    dynamicSupplies(switches: Demandable[], links: ((ext: T) => (Resource | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
        if (this.dynamicSupplySwitches != null) {
            let err: any = new Error(repeatedDynamicMessage("dynamicSupplies", this.extent));
            err.extent = this.extent;
            throw err;
        }
        this.dynamicSupplySwitches = switches;
        this.dynamicSupplyLinks = links;
        if (relinkingOrder != undefined) {
            this.dynamicSupplyRelinkingOrder = relinkingOrder;
        }
        return this;
    }

    /** Finishes the behavior with the code to run. `block` receives the extent; inside it, read only demanded or supplied resources and update only supplied ones. */
    runs(block: (ext: T) => void): Behavior {
        let hasDynamicDemands = this.dynamicDemandSwitches != null;
        if (this.untrackedDemands == null) { this.untrackedDemands = []; }
        if (this.untrackedSupplies == null) { this.untrackedSupplies = []; }
        // .trace links never activate a behavior, so one whose every demand is .trace never runs
        if (!hasDynamicDemands && this.untrackedDemands.length > 0 && this.untrackedDemands.every(d => d.type == LinkType.trace)) {
            let err: any = new Error(traceOnlyMessage(this.extent, this.untrackedDemands, this.untrackedSupplies));
            err.extent = this.extent;
            throw err;
        }
        let dynamicDemandResource: Resource;
        if (hasDynamicDemands) {
            dynamicDemandResource = this.extent.resource('(BG Dynamic Demand Resource)')
            if (this.dynamicDemandRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                this.untrackedDemands!.push(dynamicDemandResource);
            } else {
                this.untrackedSupplies!.push(dynamicDemandResource);
            }
        }

        let hasDynamicSupplies = this.dynamicSupplySwitches != null;
        let dynamicSupplyResource: Resource;
        if (hasDynamicSupplies) {
            dynamicSupplyResource = this.extent.resource('(BG Dynamic Supply Resource)');
            if (this.dynamicSupplyRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                this.untrackedDemands!.push(dynamicSupplyResource);
            } else {
                this.untrackedSupplies!.push(dynamicSupplyResource);
            }
        }

        let mainBehavior = new Behavior(this.extent, this.untrackedDemands, this.untrackedSupplies, block as (arg0: Extent) => void);

        if (hasDynamicDemands) {
            let supplies: Resource[] = [];
            let demands: Demandable[] | null = this.dynamicDemandSwitches;
            if (this.dynamicDemandRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                supplies.push(dynamicDemandResource!);
            } else {
                if (demands == null) { demands = [] }
                demands.push(dynamicDemandResource!);
            }
            new Behavior(this.extent, demands, supplies, ((extent: T) => {
               let demandLinks = this.dynamicDemandLinks!(extent);
               mainBehavior.setDynamicDemands(demandLinks);
            }) as (arg0: Extent) => void);
        }

        if (hasDynamicSupplies) {
            let supplies: Resource[] = [];
            let demands: Demandable[] | null = this.dynamicSupplySwitches;
            if (this.dynamicSupplyRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                supplies.push(dynamicSupplyResource!);
            } else {
                if (demands == null) { demands = [] }
                demands.push(dynamicSupplyResource!);
            }
            new Behavior(this.extent, demands, supplies, ((extent: T) => {
                let supplyLinks = this.dynamicSupplyLinks!(extent);
                mainBehavior.setDynamicSupplies(supplyLinks);
            }) as (arg0: Extent) => void);
        }

        return mainBehavior;
    }
}