// Compiles typical user code against the built type files in lib/, with full library checking,
// so a change that breaks the published .d.ts files (for example a public declaration that
// refers to a member stripped as @internal) fails here. Run with `npm run test-types` after
// `npm run build`.

import { Graph, Extent, State, Moment, Resource, Behavior, GraphEvent, Demandable,
         ExtentRemoveStrategy, RelinkingOrder, LinkType } from "behavior-graph";

class Item extends Extent {
  done = this.state(false);
  toggle = this.moment();
  constructor(graph: Graph, readonly id: string) {
    super(graph);
    this.behavior().demands(this.toggle).supplies(this.done)
      .runs((ext) => { ext.done.update(!ext.done.value); });
  }
}

class List extends Extent {
  addRequested = this.moment<string>();
  items = this.state<Item[]>([]);
  doneCount = this.state(0);
  ticked = this.resource();

  constructor(graph: Graph) {
    super(graph);
    this.behavior()
      .demands(this.addRequested, this.addedToGraph)
      .supplies(this.items, this.ticked)
      .runs((ext) => {
        if (ext.addRequested.justUpdated) {
          const item = new Item(ext.graph, ext.addRequested.value!);
          ext.addChildLifetime(item);
          item.addToGraph();
          ext.items.update([...ext.items.value, item]);
        }
      });
    this.behavior()
      .demands(this.items, this.ticked.order, this.doneCount.trace)
      .dynamicDemands([this.items], (ext) => ext.items.value.map((i) => i.done), RelinkingOrder.relinkingOrderPrior)
      .supplies(this.doneCount)
      .runs((ext) => {
        const before: number = ext.doneCount.traceValue;
        ext.doneCount.update(ext.items.value.filter((i) => i.done.value).length);
        ext.sideEffect((e) => { console.log(before, e.doneCount.value, e.doneCount.justUpdatedFrom(before)); });
      });
  }
}

// Introspection and debugging members named in AGENT_GUIDE.md stay public.
const graph = new Graph();
graph.validateTraceDemands = true;
graph.validateLifetimes = true;
graph.dateProvider = { now: () => new Date(0) };
const list = new List(graph);
list.addToGraphWithAction();
const behavior: Behavior = list.behaviors[0];
const supplies: Set<Resource> | null = behavior.supplies;
const order: number = behavior.order;
const supplier: Behavior | null = list.items.suppliedBy;
const event: GraphEvent = graph.lastEvent;
const removed: number | null = list.addedToGraphWhen;
const traced: Demandable = list.doneCount.trace;
const isTrace: boolean = traced.type === LinkType.trace;
const moment: Moment<string> = list.addRequested;
const state: State<number> = list.doneCount;
const unsubscribe: () => void = graph.subscribeToJustUpdated([list.items], () => {});
const text: string = graph.debugHere() + behavior.toString() + RelinkingOrder.relinkingOrderSubsequent;
list.removeFromGraphWithAction(ExtentRemoveStrategy.containedLifetimes);
