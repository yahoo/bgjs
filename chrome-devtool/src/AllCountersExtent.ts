import * as bg from "behavior-graph";
import { CounterExtent } from "./CounterExtent";
import produce from "immer"

export class AllCountersExtent extends bg.Extent {
    resetCounters: bg.Moment = this.moment();
    addCounter: bg.Moment = this.moment();
    total: bg.State<number> = this.state(0);
    counters: bg.State<CounterExtent[]> = this.state([]);
    nextId: bg.State<number> = this.state(0);
    removeCounter: bg.Moment<CounterExtent> = this.moment();

    constructor(gr: bg.Graph) {
        super(gr);

        this.behavior()
            .supplies(this.removeCounter)
            .dynamicDemands([this.counters], ext => {
                return this.counters.value.map(counter => counter.remove);
            }, bg.RelinkingOrder.relinkingOrderSubsequent)
            .runs(ext => {
                for (let counter of this.counters.traceValue) {
                    if (counter.remove.justUpdated) {
                        this.removeCounter.update(counter);
                        return;
                    }
                }
            });

        this.behavior()
            .supplies(this.counters, this.nextId)
            .demands(this.addCounter, this.removeCounter)
            .runs(ext => {
                if (this.addCounter.justUpdated) {
                    let newCounter = new CounterExtent(ext.graph, ext, this.nextId.value);
                    ext.addChildLifetime(newCounter);
                    newCounter.addToGraph();
                    let newCounters = produce(ext.counters.value, draft => { draft.push(newCounter) })
                    ext.counters.update(newCounters);
                    ext.nextId.update(ext.nextId.value + 1);
                } else if (this.removeCounter.justUpdated) {
                    let newCounters = this.counters.value.filter(item => item !== this.removeCounter.value);
                    ext.counters.update(newCounters);
                }
            });

        this.behavior()
            .supplies(this.total)
            .demands(this.counters)
            .dynamicDemands([this.counters], ext => {
                return this.counters.value.map((counter) => counter.count);
            })
            .runs(ext => {
                this.total.update(this.counters.value.reduce((accumulator, currentValue) => accumulator + currentValue.count.value, 0));
            });

    }
}