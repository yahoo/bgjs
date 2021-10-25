//
//  Copyright Yahoo 2021
//


import {Orderable} from "./bufferedqueue";
import {Extent, Named} from "./extent";
import {Resource} from "./resource";
import {OrderingState} from "./bggraph"

export class Behavior implements Orderable {
    demands: Set<Resource> | null;
    supplies: Set<Resource> | null;
    block: (extent: Extent) => void;
    enqueuedWhen: number | null = null;
    removedWhen: number | null = null;
    added: boolean = false;
    extent: Extent;
    orderingState: OrderingState = OrderingState.Untracked;
    order: number = 0;

    untrackedDemands: Resource[] | null;
    untrackedSupplies: Resource[] | null;

    constructor(extent: Extent, demands: Resource[] | null, supplies: Resource[] | null, block: (extent: Extent) => void) {
        this.extent = extent;
        extent.addBehavior(this);
        this.demands = null;
        this.supplies = null;
        this.block = block;
        this.untrackedDemands = demands;
        this.untrackedSupplies = supplies;
    }

    setDemands(newDemands: Resource[]) {
        this.extent.graph.updateDemands(this, newDemands);
    }

    setSupplies(newSupplies: Resource[]) {
        this.extent.graph.updateSupplies(this, newSupplies);
    }
}
