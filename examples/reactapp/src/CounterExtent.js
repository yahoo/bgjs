import * as bg from "behavior-graph"

export class CounterExtent extends bg.Extent {
    increment = this.moment();
    count = this.state(0);
    remove = this.moment();

    id;

    constructor(gr, allCounters, id) {
        super(gr);

        this.id = id;

        this.behavior()
            .supplies(this.count)
            .demands(this.increment, allCounters.resetCounters)
            .runs( ext => {
                if (this.increment.justUpdated) {
                    this.count.update(this.count.value + 1);
                } else if (allCounters.resetCounters.justUpdated) {
                    this.count.update(0);
                }
            });
    }
}