import * as bg from "behavior-graph";
import { CounterExtent } from "./CounterExtent";
import produce from "immer"
import $ from "cash-dom";
import {Cash} from "cash-dom/dist/cash";
import * as nanoid from "nanoid";

export class AllCountersExtent extends bg.Extent {
    resetCounters = this.moment();
    addCounter = this.moment();
    total = this.state(0);
    counters: bg.State<CounterExtent[]> = this.state([]);
    nextId = this.state(0);
    removeCounter = this.moment();

    htmlElement: Cash;
    counterId: string = `counter-${nanoid.nanoid}`;
    resetId: string = `reset-${nanoid.nanoid}`;
    addCounterId: string = `add-counter-${nanoid.nanoid}`;

    constructor(gr: bg.Graph, app: HTMLElement) {
        super(gr);


        document.create
        this.htmlElement = app.html(`
<div>
    <div><h1>Counter Total: <span id="${this.counterId}"></span></h1></div>
    <button id="${this.resetId}" onClick={() => allCounters.resetCounters.updateWithAction()}>Reset All</button>
    <button id=${this.addCounterId} onClick={() => allCounters.addCounter.updateWithAction()}>Add Counter</button>
    <ul id="counters-list">
    </ul>
</div>
`);
        $("#${")

        mainGraph.subscribeToJustUpdated([allCounters.addedToGraph, allCounters.total], () => {
            $("#counter-total", app).html(String(allCounters.total.value));
        });
        $("#reset", app).on("click", () => {
            allCounters.resetCounters.updateWithAction();
        });
        $("#add-counter", app).on("click", () => {
            allCounters.addCounter.updateWithAction();
        });

        this.behavior()
            .supplies(this.removeCounter)
            .dynamicDemands([this.counters], () => {
                return this.counters.value.map(counter => counter.remove);
            }, bg.RelinkingOrder.relinkingOrderSubsequent)
            .runs(() => {
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
            .dynamicDemands([this.counters], () => {
                return this.counters.value.map((counter) => counter.count);
            })
            .runs(() => {
                this.total.update(this.counters.value.reduce((accumulator, currentValue) => accumulator + currentValue.count.value, 0));
            });

    }
}