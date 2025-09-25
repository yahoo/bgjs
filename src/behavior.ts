//
//  Copyright Yahoo 2021
//


import {Orderable} from "./bufferedqueue.js";
import {Extent} from "./extent.js";
import {Signal, Demandable} from "./resource.js";
import {OrderingState, RelinkingOrder} from "./common";


export class Behavior implements Orderable {
    demands: Set<Signal> | null;
    orderingDemands: Set<Signal> | null;
    supplies: Set<Signal> | null;
    block: (extent: Extent) => void;
    enqueuedWhen: number | null = null;
    removedWhen: number | null = null;
    extent: Extent;
    orderingState: OrderingState = OrderingState.Untracked;
    order: number = 0;

    untrackedDemands: Demandable[] | null;
    untrackedDynamicDemands: Demandable[] | null;
    untrackedSupplies: Signal[] | null;
    untrackedDynamicSupplies: Signal[] | null;

    constructor(extent: Extent, demands: Demandable[] | null, supplies: Signal[] | null, block: (extent: Extent) => void) {
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

    setDynamicSupplies(newSupplies: (Signal | undefined)[] | null) {
        this.extent.graph.updateSupplies(this, newSupplies?.filter(item => item !== undefined) as (Signal[] | null));
    }


}

export class BehaviorBuilder<T extends Extent> {
    extent: T;
    untrackedDependencies: Demandable[] | null = null;
    untrackedSupplies: Signal[] | null = null;
    dynamicDependencySwitches: Demandable[] | null = null;
    dynamicDependencyLinks: ((ext: T) => (Demandable | undefined)[] | null) | null = null;
    dynamicDependencyRelinkingOrder : RelinkingOrder = RelinkingOrder.relinkingOrderPrior;
    dynamicSupplySwitches: Demandable[] | null = null;
    dynamicSupplyLinks: ((ext: T) => (Signal | undefined)[] | null) | null = null;
    dynamicSupplyRelinkingOrder : RelinkingOrder = RelinkingOrder.relinkingOrderPrior;

    constructor(extent: T) {
        this.extent = extent;
    }

    dependencies(...dependencies: Demandable[]): this {
        this.untrackedDependencies = dependencies;
        return this;
    }

    /**
     * @deprecated Use dependencies instead. This will be removed in a future version.
     */
    demands(...demands: Demandable[]): this {
        return this.dependencies(...demands);
    }

    /**
     * @deprecated Use dependencies instead. This will be removed in a future version.
     */
    dependsOn(...dependencies: Demandable[]): this {
        return this.dependencies(...dependencies);
    }

    supplies(...supplies: Signal[]): this {
        this.untrackedSupplies = supplies;
        return this;
    }

    dynamicDependencies(switches: Demandable[], links: ((ext: T) => (Demandable | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
        this.dynamicDependencySwitches = switches;
        this.dynamicDependencyLinks = links;
        if (relinkingOrder != undefined) {
            this.dynamicDependencyRelinkingOrder = relinkingOrder;
        }
        return this;
    }

    /**
     * @deprecated Use dynamicDependencies instead. This will be removed in a future version.
     */
    dynamicDemands(switches: Demandable[], links: ((ext: T) => (Demandable | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
        return this.dynamicDependencies(switches, links, relinkingOrder);
    }

    dynamicSupplies(switches: Demandable[], links: ((ext: T) => (Signal | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
        this.dynamicSupplySwitches = switches;
        this.dynamicSupplyLinks = links;
        if (relinkingOrder != undefined) {
            this.dynamicSupplyRelinkingOrder = relinkingOrder;
        }
        return this;
    }

    runs(block: (ext: T) => void): Behavior {
        let hasDynamicDependencies = this.dynamicDependencySwitches != null;
        if (this.untrackedDependencies == null) { this.untrackedDependencies = []; }
        if (this.untrackedSupplies == null) { this.untrackedSupplies = []; }
        let dynamicDependencySignal: Signal;
        if (hasDynamicDependencies) {
            dynamicDependencySignal = this.extent.resource('(BG Dynamic Dependency Signal)')
            if (this.dynamicDependencyRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                this.untrackedDependencies!.push(dynamicDependencySignal);
            } else {
                this.untrackedSupplies!.push(dynamicDependencySignal);
            }
        }

        let hasDynamicSupplies = this.dynamicSupplySwitches != null;
        let dynamicSupplySignal: Signal;
        if (hasDynamicSupplies) {
            dynamicSupplySignal = this.extent.resource('(BG Dynamic Supply Signal)');
            if (this.dynamicSupplyRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                this.untrackedDependencies!.push(dynamicSupplySignal);
            } else {
                this.untrackedSupplies!.push(dynamicSupplySignal);
            }
        }

        let mainBehavior = new Behavior(this.extent, this.untrackedDependencies, this.untrackedSupplies, block as (arg0: Extent) => void);

        if (hasDynamicDependencies) {
            let supplies: Signal[] = [];
            let dependencies: Demandable[] | null = this.dynamicDependencySwitches;
            if (this.dynamicDependencyRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                supplies.push(dynamicDependencySignal!);
            } else {
                if (dependencies == null) { dependencies = [] }
                dependencies.push(dynamicDependencySignal!);
            }
            new Behavior(this.extent, dependencies, supplies, ((extent: T) => {
               let dependencyLinks = this.dynamicDependencyLinks!(extent);
               mainBehavior.setDynamicDemands(dependencyLinks);
            }) as (arg0: Extent) => void);
        }

        if (hasDynamicSupplies) {
            let supplies: Signal[] = [];
            let dependencies: Demandable[] | null = this.dynamicSupplySwitches;
            if (this.dynamicSupplyRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                supplies.push(dynamicSupplySignal!);
            } else {
                if (dependencies == null) { dependencies = [] }
                dependencies.push(dynamicSupplySignal!);
            }
            new Behavior(this.extent, dependencies, supplies, ((extent: T) => {
                let supplyLinks = this.dynamicSupplyLinks!(extent);
                mainBehavior.setDynamicSupplies(supplyLinks);
            }) as (arg0: Extent) => void);
        }

        return mainBehavior;
    }
}