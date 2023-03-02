import * as bg from "behavior-graph";
import { AllCountersExtent} from "./AllCountersExtent";
import $ from "cash-dom";

export class CounterExtent extends bg.Extent {
    increment = this.moment();
    count = this.state(0);
    remove = this.moment();

    id;
    htmlElement = $(`
    <li>
        <h3>Count: <span id="count">{count}</span></h3>
        <button onClick={() => counterExtent.increment.updateWithAction()}>Increment</button>
        <button onClick={() => counterExtent.remove.updateWithAction()}>Remove</button>
    </li>
    `)

    constructor(gr: bg.Graph, allCounters: AllCountersExtent, id: number) {
        super(gr);

        this.id = id;

        let element =
        this.behavior()
            .supplies(this.count)
            .demands(this.increment, allCounters.resetCounters)
            .runs( () => {
                if (this.increment.justUpdated) {
                    this.count.update(this.count.value + 1);
                } else if (allCounters.resetCounters.justUpdated) {
                    this.count.update(0);
                }
            });
    }
}