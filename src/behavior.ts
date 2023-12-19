//
//  Copyright Yahoo 2021
//


import {Orderable} from "./bufferedqueue.js";
import {Extent} from "./extent.js";
import {Resource, Demandable} from "./resource.js";
import {OrderingState, RelinkingOrder} from "./common";


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
    dynamicSupplyRelinkingOrder : RelinkingOrder = RelinkingOrder.relinkingOrderPrior;

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

    dynamicSupplies(switches: Demandable[], links: ((ext: T) => (Resource | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
        this.dynamicSupplySwitches = switches;
        this.dynamicSupplyLinks = links;
        if (relinkingOrder != undefined) {
            this.dynamicSupplyRelinkingOrder = relinkingOrder;
        }
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