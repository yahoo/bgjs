//
//  Copyright Yahoo 2021
//


import {Orderable} from "./bufferedqueue.js";
import {Extent} from "./extent.js";
import {Signal, Dependable} from "./signal.js";
import {OrderingState, RelinkingOrder} from "./common";


export class Behavior implements Orderable {
    demands: Set<Signal<any>> | null;
    orderingDemands: Set<Signal<any>> | null;
    supplies: Set<Signal<any>> | null;
    block: (extent: Extent) => void;
    enqueuedWhen: number | null = null;
    removedWhen: number | null = null;
    extent: Extent;
    orderingState: OrderingState = OrderingState.Untracked;
    order: number = 0;

    untrackedDemands: Dependable[] | null;
    untrackedDynamicDemands: Dependable[] | null;
    untrackedSupplies: Signal<any>[] | null;
    untrackedDynamicSupplies: Signal<any>[] | null;

    constructor(extent: Extent, demands: Dependable[] | null, supplies: Signal<any>[] | null, block: (extent: Extent) => void) {
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

    setDynamicDemands(newDemands: (Dependable | undefined)[] | null) {
        this.extent.graph.updateDependencies(this, newDemands?.filter(item => item != undefined) as (Dependable[] | null));
    }

    setDynamicSupplies(newSupplies: (Signal<any> | undefined)[] | null) {
        this.extent.graph.updateSupplies(this, newSupplies?.filter(item => item !== undefined) as (Signal<any>[] | null));
    }


}

export class BehaviorBuilder<T extends Extent> {
    extent: T;
    untrackedDependencies: Dependable[] | null = null;
    untrackedSupplies: Signal<any>[] | null = null;
    dynamicDependencySwitches: Dependable[] | null = null;
    dynamicDependencyLinks: ((ext: T) => (Dependable | undefined)[] | null) | null = null;
    dynamicDependencyRelinkingOrder : RelinkingOrder = RelinkingOrder.relinkingOrderPrior;
    dynamicSupplySwitches: Dependable[] | null = null;
    dynamicSupplyLinks: ((ext: T) => (Signal<any> | undefined)[] | null) | null = null;
    dynamicSupplyRelinkingOrder : RelinkingOrder = RelinkingOrder.relinkingOrderPrior;

    constructor(extent: T) {
        this.extent = extent;
    }

    dependsOn(...dependencies: Dependable[]): this {
        this.untrackedDependencies = dependencies;
        return this;
    }


    supplies(...supplies: Signal<unknown>[]): this {
        this.untrackedSupplies = supplies;
        return this;
    }

    dynamicDependsOn(switches: Dependable[], links: ((ext: T) => (Dependable | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
        this.dynamicDependencySwitches = switches;
        this.dynamicDependencyLinks = links;
        if (relinkingOrder != undefined) {
            this.dynamicDependencyRelinkingOrder = relinkingOrder;
        }
        return this;
    }


    dynamicSupplies(switches: Dependable[], links: ((ext: T) => (Signal<any> | undefined)[] | null), relinkingOrder?: RelinkingOrder): this {
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
        let dynamicDependencySignal: Signal<any>;
        if (hasDynamicDependencies) {
            dynamicDependencySignal = this.extent.signal('(BG Dynamic Dependency Signal)')
            if (this.dynamicDependencyRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                this.untrackedDependencies!.push(dynamicDependencySignal);
            } else {
                this.untrackedSupplies!.push(dynamicDependencySignal);
            }
        }

        let hasDynamicSupplies = this.dynamicSupplySwitches != null;
        let dynamicSupplySignal: Signal<any>;
        if (hasDynamicSupplies) {
            dynamicSupplySignal = this.extent.signal('(BG Dynamic Supply Signal)');
            if (this.dynamicSupplyRelinkingOrder == RelinkingOrder.relinkingOrderPrior) {
                this.untrackedDependencies!.push(dynamicSupplySignal);
            } else {
                this.untrackedSupplies!.push(dynamicSupplySignal);
            }
        }

        let mainBehavior = new Behavior(this.extent, this.untrackedDependencies, this.untrackedSupplies, block as (arg0: Extent) => void);

        if (hasDynamicDependencies) {
            let supplies: Signal<any>[] = [];
            let dependencies: Dependable[] | null = this.dynamicDependencySwitches;
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
            let supplies: Signal<any>[] = [];
            let dependencies: Dependable[] | null = this.dynamicSupplySwitches;
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