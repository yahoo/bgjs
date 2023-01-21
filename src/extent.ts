//
//  Copyright Yahoo 2021
//


import {Graph} from "./graph.js";
import {Behavior, BehaviorBuilder, RelinkingOrder} from "./behavior.js";
import {Moment, Resource, State} from "./resource.js";

export enum ExtentRemoveStrategy {
    extentOnly,
    containedLifetimes
}

class ExtentLifetime {
    addedToGraphWhen: number | null = null;
    extents: Set<Extent> = new Set();
    children: Set<ExtentLifetime> | null = null;
    parent: ExtentLifetime | null = null;
    constructor(extent: Extent) {
        this.extents.add(extent);
        if (extent.addedToGraphWhen != null) {
            this.addedToGraphWhen = extent.addedToGraphWhen;
        }
    }

    unify(extent: Extent) {
        if (extent.addedToGraphWhen != null) {
            let err: any = new Error("Same lifetime relationship must be established before adding any extent to graph.");
            err.extent = extent;
            throw err;
        }
        if (extent.lifetime != null) {
            // merge existing lifetimes and children into one lifetime heirarchy
            // move children first
            if (extent.lifetime.children != null) {
                for (let child of extent.lifetime.children) {
                    this.addChildLifetime(child);
                }
            }
            // then make any extents in other lifetime part of this one
            for (let ext of extent.lifetime.extents) {
                ext.lifetime = this;
                this.extents.add(ext);
            }
        } else {
            extent.lifetime = this;
            this.extents.add(extent);
        }
    }

    addChild(extent:Extent) {
        if (extent.lifetime == null) {
            extent.lifetime = new ExtentLifetime(extent);
        }
        this.addChildLifetime(extent.lifetime!);
    }

    addChildLifetime(lifetime: ExtentLifetime) {
        let myLifetime : ExtentLifetime | null = this;
        while (myLifetime != null) {
            if (myLifetime === lifetime) {
                let err: any = new Error("Child lifetime cannot be a transitive parent.");
                err.extent = lifetime;
                throw err;
            }
            myLifetime = myLifetime.parent;
        }
        lifetime.parent = this;
        if (this.children == null) {
            this.children = new Set<ExtentLifetime>();
        }
        this.children!.add(lifetime);
    }

    hasCompatibleLifetime(lifetime: ExtentLifetime | null): boolean {
        if (this === lifetime) {
            // unified
            return true;
        } else if (lifetime != null) {
            // parents
            if (this.parent != null) {
                return this.parent.hasCompatibleLifetime(lifetime);
            }
        }
        return false;
    }

    getAllContainedExtents(): Extent[] {
        let extents = [];
        for (let ext of this.extents) {
            extents.push(ext);
        }
        if (this.children != null) {
            for (let childLifetime of this.children) {
                extents.push(...childLifetime.getAllContainedExtents());
            }
        }
        return extents;
    }

    getAllContainingExtents(): Extent[] {
        let extents = [];
        for (let ext of this.extents) {
            extents.push(ext);
        }
        if (this.parent != null) {
            extents.push(...this.parent.getAllContainingExtents());
        }
        return extents;
    }
}

export class Extent {
    debugConstructorName: string | undefined;
    debugName: string | undefined;
    behaviors: Behavior[] = [];
    resources: Resource[] = [];
    graph: Graph;
    addedToGraphWhen: number | null = null;
    addedToGraph: State<boolean>;
    lifetime: ExtentLifetime | null = null;
    static readonly removeContainedLifetimes = ExtentRemoveStrategy.containedLifetimes;
    static readonly relinkingOrderSubsequent = RelinkingOrder.relinkingOrderSubsequent;

    constructor(graph: Graph) {
        if (graph === null || graph === undefined) {
            let err: any = new Error("Extent must be initialized with an instance of Graph");
            err.extent = this;
            throw err;
        }
        this.debugConstructorName = this.constructor.name;
        this.graph = graph;
        this.addedToGraph = new State<boolean>(this, false);
    }

    unifyLifetime<T extends Extent>(extent: T) {
        if (this.lifetime == null) {
            this.lifetime = new ExtentLifetime(this);
        }
        this.lifetime.unify(extent);
    }

    addChildLifetime<T extends Extent>(extent: T) {
        if (this.lifetime == null) {
            this.lifetime = new ExtentLifetime(this);
        }
        this.lifetime.addChild(extent);
    }

    hasCompatibleLifetime<T extends Extent>(extent: T): boolean {
        if (this === extent as Extent) {
            return true;
        } else if (this.lifetime != null) {
            return (this.lifetime.hasCompatibleLifetime(extent.lifetime));
        } else {
            return false;
        }
    }

    addBehavior(behavior: Behavior) {
        this.behaviors.push(behavior);
    }

    addResource(resource: Resource) {
        this.resources.push(resource);
    }

    addToGraphWithAction(debugName?: string) {
        this.graph.action(() => {
            this.addToGraph();
        }, debugName);
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

    removeFromGraphWithAction(strategy?: ExtentRemoveStrategy, debugName?: string) {
        this.action(() => {
            this.removeFromGraph(strategy);
        }, debugName);
    }

    removeFromGraph(strategy?: ExtentRemoveStrategy) {
        let graph = this.graph;
        if (graph.currentEvent != null) {
            if (this.addedToGraphWhen != null) {
                if (strategy == ExtentRemoveStrategy.extentOnly || strategy === undefined || this.lifetime === null) {
                    graph.removeExtent(this);
                } else {
                    for (let ext of this.lifetime.getAllContainedExtents()) {
                        graph.removeExtent(ext);
                    }
                }
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
            if (object && (object as any)['isResource'] !== undefined) {
                if ((object as any as Resource).debugName == null) {
                    (object as any as Resource).debugName = key;
                }
            }
        }
    }

    behavior(): BehaviorBuilder<this> {
        let b: BehaviorBuilder<this> = new BehaviorBuilder(this);
        return b;
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
        this.graph.sideEffectHelper({
            debugName: debugName,
            block: (block as (arg0: Extent | null) => void),
            extent: this,
            behavior: this.graph.currentBehavior
        });
    }

    async actionAsync(action: (ext: this) => void, debugName?: string) {
        return this.graph.actionAsyncHelper({
            block: action as (arg0: Extent | null) => void,
            debugName: debugName,
            extent: this,
            resolve: null
        })
    }

    action(action: (ext: this) => void, debugName?: string) {
        this.graph.actionHelper({
            block: action as (arg0: Extent | null) => void,
            debugName: debugName,
            extent: this,
            resolve: null
        })
    }
}
