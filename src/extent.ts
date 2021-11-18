//
//  Copyright Yahoo 2021
//


import {Graph} from "./bggraph";
import {Behavior} from "./behavior";
import {Moment, Resource, State} from "./resource";

export interface Named {
    debugName: string | undefined;
}

function isNamed(arg: any): arg is Named {
    return (arg as Named).debugName !== undefined;
}

export class Extent implements Named {
    debugConstructorName: string | undefined;
    debugName: string | undefined;
    behaviors: Behavior[] = [];
    resources: Resource[] = [];
    graph: Graph;
    addedToGraphWhen: number | null = null;
    added: State<boolean>;
    addedToGraphBehavior: Behavior;

    constructor(graph: Graph) {
        this.debugConstructorName = this.constructor.name;
        this.graph = graph;
        // this hidden behavior supplies addedToGraph and gets activated independently when an
        // extent is added to the graph
        this.added = new State<boolean>(this, false);
        this.addedToGraphBehavior = this.behavior(null, [this.added], (extent) => {
            extent.added.update(true);
        });
    }

    addBehavior(behavior: Behavior) {
        this.behaviors.push(behavior);
    }

    addResource(resource: Resource) {
        this.resources.push(resource);
    }

    addToGraphWithAction(debugName?: string) {
        this.graph.action(() => { this.addToGraph(); }, debugName);
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

    removeFromGraphWithAction(debugName?: string) {
        this.action(() => { this.removeFromGraph(); }, debugName);
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

    behavior(demands: Resource[] | null, supplies: Resource[] | null, block: (ext: this) => void): Behavior {
        let behavior = new Behavior(this, demands, supplies, block as (arg0: Extent) => void);
        return behavior;
    }

    resource(name?: string): Resource {
        return new Resource(this, name);
    }

    moment<T>(name?: string): Moment<T> {
        return new Moment<T>(this, name);
    }

    state<T>(initialState: T, name?: string): State<T> {
        return new State<T>(this, initialState, name);
    }

    sideEffect(block: (ext: this) => void, debugName?: string) {
        // This requires a cast because we know the extent won't be null at runtime because this side effect
        // was created with one
        this.graph.sideEffectHelper({ debugName: debugName, block: (block as (arg0: Extent | null) => void), extent: this, behavior: this.graph.currentBehavior });
    }

    async actionAsync(action: (ext: this) => void, debugName?: string) {
        return this.graph.actionAsyncHelper({block: action as (arg0: Extent | null) => void, debugName: debugName, extent: this, resolve:null })
    }

    action(action: (ext: this) => void, debugName?: string) {
        this.graph.actionHelper({block: action as (arg0: Extent | null) => void, debugName: debugName, extent: this, resolve: null })
    }
}
