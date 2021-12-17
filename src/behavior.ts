//
//  Copyright Yahoo 2021
//


import {Orderable} from "./bufferedqueue";
import {Extent} from "./extent";
import {Resource, Demandable} from "./resource";
import {OrderingState} from "./graph"

export enum RelinkingOrder {
    relinkingOrderPrior,
    relinkingOrderSubsequent
}

export class Behavior implements Orderable {
    demands: Set<Resource> | null;
    orderingDemands: Set<Resource> | null;
    supplies: Set<Resource> | null;
    block: (extent: Extent) => void;
    enqueuedWhen: number | null = null;
    removedWhen: number | null = null;
    extent: Extent;
    orderingState: OrderingState = OrderingState.Untracked;
    order: number = 0;

    untrackedDemands: Demandable[] | null;
    untrackedDynamicDemands: Demandable[] | null;
    untrackedSupplies: Resource[] | null;
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

    setDynamicDemands(newDemands: (Demandable | undefined)[] | null) {
        this.extent.graph.updateDemands(this, newDemands?.filter(item => item != undefined) as (Demandable[] | null));
    }

    setDynamicSupplies(newSupplies: (Resource | undefined)[] | null) {
        this.extent.graph.updateSupplies(this, newSupplies?.filter(item => item !== undefined) as (Resource[] | null));
    }

}

export class BehaviorBuilder<T extends Extent> {
    extent: T;
    untrackedDemands: Demandable[] | null = null;
    untrackedSupplies: Resource[] | null = null;
    dynamicDemandSwitches: Demandable[] | null = null;
    dynamicDemandLinks: ((ext: T) => (Demandable | undefined)[] | null) | null = null;
    dynamicDemandRelinkingOrder : RelinkingOrder = RelinkingOrder.relinkingOrderPrior;
    dynamicSupplySwitches: Demandable[] | null = null;
    dynamicSupplyLinks: ((ext: T) => (Resource | undefined)[] | null) | null = null;

    constructor(extent: T) {
        this.extent = extent;
    }

    demands(...demands: Demandable[]): this {
        this.untrackedDemands = demands;
        return this;
    }

    supplies(...supplies: Resource[]): this {
        this.untrackedSupplies = supplies;
        return this;
    }

    dynamicDemands(switches: Demandable[], links: ((ext: T) => (Demandable | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
        this.dynamicDemandSwitches = switches;
        this.dynamicDemandLinks = links;
        if (relinkingOrder != undefined) {
            this.dynamicDemandRelinkingOrder = relinkingOrder;
        }
        return this;
    }

    dynamicSupplies(switches: Demandable[], links: ((ext: T) => (Resource | undefined)[] | null)): this {
        this.dynamicSupplySwitches = switches;
        this.dynamicSupplyLinks = links;
        return this;
    }

    runs(block: (ext: T) => void): Behavior {
        let hasDynamicDemands = this.dynamicDemandSwitches != null;
        if (this.untrackedDemands == null) { this.untrackedDemands = []; }
        if (this.untrackedSupplies == null) { this.untrackedSupplies = []; }
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
            this.untrackedDemands!.push(dynamicSupplyResource);
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
            new Behavior(this.extent, this.dynamicSupplySwitches, [dynamicSupplyResource!], ((extent: T) => {
                let supplyLinks = this.dynamicSupplyLinks!(extent);
                mainBehavior.setDynamicSupplies(supplyLinks);
            }) as (arg0: Extent) => void);
        }

        return mainBehavior;
    }
}