//
//  Copyright Yahoo 2021
//


import {Graph} from "./bggraph";
import {Behavior} from "./behavior";
import {Resource, State} from "./resource";

export interface Named {
    debugName: string | null;
}

function isNamed(arg: any): arg is Named {
    return (arg as Named).debugName !== undefined;
}

export class Extent implements Named {
    debugName: string | null;
    behaviors: Behavior[] = [];
    resources: Resource[] = [];
    graph: Graph;
    addedToGraphWhen: number | null = null;
    addedToGraph: State<boolean>;
    addedToGraphBehavior: Behavior;

    constructor(graph: Graph) {
        this.debugName = this.constructor.name;
        this.graph = graph;
        // this hidden behavior supplies addedToGraph and gets activated independently when an
        // extent is added to the graph
        this.addedToGraph = new State<boolean>(this, false);
        this.addedToGraphBehavior = this.makeBehavior(null, [this.addedToGraph], (extent) => {
            this.addedToGraph.update(true, true);
        });
    }

    addBehavior(behavior: Behavior) {
        this.behaviors.push(behavior);
    }

    addResource(resource: Resource) {
        this.resources.push(resource);
    }

    addToGraphWithAction() {
        this.graph.action('add extent: ' + this.debugName, () => { this.addToGraph(); });
    }

    addToGraph() {
        if (this.graph.currentEvent != null) {
            this.nameResources();
            this.graph.addExtent(this);
        } else {
            let err: any = new Error("addToGraph must be called within an event.");
            err.extent = this;
            throw err;
        }
    }

    removeFromGraphWithAction() {
        this.graph.action('remove extent: ' + this.debugName, () => { this.removeFromGraph(); });
    }

    removeFromGraph() {
        let graph = this.graph;
        if (graph.currentEvent != null) {
            if (this.addedToGraphWhen != null) {
                graph.removeExtent(this);
            }
        } else {
            let err: any = new Error("removeFromGraph must be called within an event.");
            err.extent = this;
            throw err;
        }
    }

    nameResources() {
        // automatically add any behaviors and resources that are contained
        // by this Extent object and name them with corresponding keys
        for (let key in this) {
            let object = this[key];
            if (object == null || object == undefined) { continue; }
            if (isNamed(object)) {
                if (object.debugName == null) {
                    object.debugName = key;
                }
            }
        }
    }

    makeBehavior(demands: Resource[] | null, supplies: Resource[] | null, block: (extent: this) => void): Behavior {
        let behavior = new Behavior(this, demands, supplies, block as (extent: Extent) => void);
        return behavior;
    }

    sideEffect(name: string | null, block: (extent: this) => void) {
        if (this.addedToGraphWhen != null) {
            this.graph.sideEffect(this, name, block as (extent: Extent) => void);
        }
    }

    actionAsync(impulse: string | null, action: () => void) {
        if (this.addedToGraphWhen != null) {
            this.graph.actionAsync(impulse, action);
        } else {
            let err: any = new Error("Action on extent requires it be added to the graph.");
            err.extent = this;
            throw err;
        }
    }

    action(impulse: string | null, action: () => void) {
        if (this.addedToGraphWhen != null) {
            this.graph.action(impulse, action);
        } else {
            let err: any = new Error("Action on extent requires it be added to the graph.");
            err.extent = this;
            throw err;
        }
    }
}
