//
//  Copyright Yahoo 2021
//


import {Orderable} from "./bufferedqueue";
import {Extent} from "./extent";
import {Resource, Demandable} from "./resource";
import {OrderingState} from "./bggraph"

export class Behavior implements Orderable {
    demands: Set<Resource> | null;
    orderingDemands: Set<Resource> | null;
    supplies: Set<Resource> | null;
    block: (extent: Extent) => void;
    enqueuedWhen: number | null = null;
    removedWhen: number | null = null;
    added: boolean = false;
    extent: Extent;
    orderingState: OrderingState = OrderingState.Untracked;
    order: number = 0;

    untrackedDemands: Demandable[] | null;
    untrackedSupplies: Resource[] | null;

    constructor(extent: Extent, demands: Demandable[] | null, supplies: Resource[] | null, block: (extent: Extent) => void) {
        this.extent = extent;
        extent.addBehavior(this);
        this.demands = null;
        this.orderingDemands = null;
        this.supplies = null;
        this.block = block;
        this.untrackedDemands = demands;
        this.untrackedSupplies = supplies;
    }

    setDemands(newDemands: Demandable[]) {
        this.extent.graph.updateDemands(this, newDemands);
    }

    setSupplies(newSupplies: Resource[]) {
        this.extent.graph.updateSupplies(this, newSupplies);
    }

}

export class DynamicDemands<T extends Extent> {
    switches: Demandable[];
    links: (ext: T) => Demandable[] | null
    constructor(switches: Demandable[], links: (ext: T) => Demandable[] | null) {
        this.switches = switches;
        this.links = links;
    }
}

export class DynamicSupplies<T extends Extent> {
    switches: Demandable[];
    links: (ext: T) => Resource[] | null
    constructor(switches: Demandable[], links: (ext: T) => Resource[] | null) {
        this.switches = switches;
        this.links = links;
    }
}

export class BehaviorBuilder<T extends Extent> {
    extent: T;
    untrackedDemands: Demandable[] | null = null;
    untrackedSupplies: Resource[] | null = null;
    dynamicDemandSwitches: Demandable[] | null = null;
    dynamicDemandLinks: ((ext: T) => Demandable[] | null) | null = null;
    dynamicSupplySwitches: Demandable[] | null = null;
    dynamicSupplyLinks: ((ext: T) => Resource[] | null) | null = null;

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

    dynamicDemands(switches: Demandable[], links: ((ext: T) => Demandable[] | null)): this {
        this.dynamicDemandSwitches = switches;
        this.dynamicDemandLinks = links;
        return this;
    }

    dynamicSupplies(switches: Demandable[], links: ((ext: T) => Resource[] | null)): this {
        this.dynamicSupplySwitches = switches;
        this.dynamicSupplyLinks = links;
        return this;
    }

    runs(block: (ext: T) => void): Behavior {
        let hasDynamicDemands = this.dynamicDemandSwitches != null;
        let dynamicDemandResource: Resource;
        if (hasDynamicDemands) {
            dynamicDemandResource = this.extent.resource('(BG Dynamic Demand Resource)')
            this.untrackedDemands?.push(dynamicDemandResource);
        }

        let hasDynamicSupplies = this.dynamicSupplySwitches != null;
        let dynamicSupplyResource: Resource;
        if (hasDynamicSupplies) {
            dynamicSupplyResource = this.extent.resource('(BG Dynamic Supply Resource)');
            this.untrackedDemands?.push(dynamicSupplyResource);
        }

        let mainBehavior = new Behavior(this.extent, this.untrackedDemands, this.untrackedSupplies, block as (arg0: Extent) => void);

        if (hasDynamicDemands) {
            new Behavior(this.extent, this.dynamicDemandSwitches, [dynamicDemandResource!], ((extent: T) => {
               let demandLinks = this.dynamicDemandLinks!(extent);
               mainBehavior.setDemands([...(this.untrackedDemands ?? []), ...(demandLinks ?? [])]);
            }) as (arg0: Extent) => void);
        }

        if (hasDynamicSupplies) {
            new Behavior(this.extent, this.dynamicSupplySwitches, [dynamicSupplyResource!], ((extent: T) => {
                let supplyLinks = this.dynamicSupplyLinks!(extent);
                mainBehavior.setSupplies([...(this.untrackedSupplies ?? []), ...(supplyLinks ?? [])]);
            }) as (arg0: Extent) => void);
        }

        return mainBehavior;
    }
}