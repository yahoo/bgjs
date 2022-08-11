import * as bg from "behavior-graph"
import console from "console"
import { performance, PerformanceObserver } from "perf_hooks"

class RootExtent extends bg.Extent {
    root : bg.Moment;
    addExtents: bg.Moment;
    extentAdder : bg.Moment;
    linkUpdater : bg.Moment;
    bulkResources : bg.Moment<undefined>[][] = [];
    bulkBehaviors : bg.Behavior[][] = [];
    subextents : Sub1Extent[] = [];
    width: number = 300;
    depth: number = 300;

    constructor(g: bg.Graph) {
        super(g);
        this.root = this.moment();
        this.extentAdder = this.moment();
        this.linkUpdater = this.moment();
        this.addExtents = this.moment();

        this.behavior()
            .supplies(this.extentAdder)
            .demands(this.addExtents)
            .runs(ext => {
                for (let i = 0; i<3; i++) {
                    let e = new Sub1Extent(g, this.root);
                    e.addToGraph();
                    this.subextents.push(e);
                }
                this.extentAdder.update();

            });

        this.behavior()
            .supplies(this.linkUpdater)
            .demands(this.extentAdder)
            .runs(extent => {
                // make all the behaviors in the first row of this extent
                // demand the resources in the first row of each subextent
                let newDemands: bg.Moment[] = [];
                for (let ext of this.subextents) {
                    newDemands.push(...ext.bulkResources[0])
                }
                for (let j = 0; j < this.width; j++) {
                    this.bulkBehaviors[0][j].setDynamicDemands(newDemands)
                }

                // make each behavior in the last row of each subextent
                // demand each resource in the last row of this extent
                let allSupplied: bg.Moment[] = this.bulkResources[this.depth - 1];
                for (let ext of this.subextents) {
                    for (let j = 0; j < ext.width; j++) {
                        ext.bulkBehaviors[ext.depth - 1][j].setDynamicDemands(allSupplied);
                    }
                }
            });

        let previousRow: bg.Moment[] = [];
        for (let i = 0; i < this.depth; i++) {
            this.bulkResources[i] = [];
            this.bulkBehaviors[i] = [];
            let demands = [this.root, this.linkUpdater].concat(previousRow);
            for (let j = 0; j < this.width; j++) {
                let moment: bg.Moment<undefined> = this.moment();
                this.bulkResources[i][j] = moment;
                this.bulkBehaviors[i][j] = this.behavior()
                    .supplies(moment)
                    .demands(...demands)
                    .runs(ext => {
                        moment.update();
                    });
            }
            previousRow = this.bulkResources[i];
        }
    }
}

class Sub1Extent extends bg.Extent {
    bulkResources : bg.Moment[][] = [];
    bulkBehaviors : bg.Behavior[][] = [];
    width: number = 10;
    depth: number = 100;

    constructor(g: bg.Graph, root: bg.Moment) {
        super(g);

        let previousRow: bg.Moment[] = [];
        for (let i = 0; i < this.depth; i++) {
            this.bulkResources[i] = [];
            this.bulkBehaviors[i] = [];
            let demands = previousRow;
            for (let j = 0; j < this.width; j++) {
                let moment: bg.Moment<undefined> = this.moment();
                this.bulkResources[i][j] = moment;
                this.bulkBehaviors[i][j] = this.behavior()
                    .supplies(moment)
                    .demands(...demands)
                    .runs(ext => {
                        moment.update();
                    });
            }
            previousRow = this.bulkResources[i];
        }

    }
}

const obs = new PerformanceObserver((items, observer) => {
    console.log(items.getEntries());
});
obs.observe({ type: 'measure' });

console.log('starting...');
// adding test

for (let i = 0; i < 1; i++) {
    let g = new bg.Graph()
    let e = new RootExtent(g)

    performance.mark('1')
    e.addToGraphWithAction();
    performance.measure('add root', '1');
    performance.mark('2')
    e.root.updateWithAction();
    performance.measure('simple update', '2');

    performance.mark('3')
    g.action(() => {
        e.root.update();
        e.addExtents.update();
    });
    performance.measure('add subextents', '3')

    performance.mark('4')
    g.action(() => {
        for (let ext of e.subextents) {
            ext.removeFromGraph();
        }
        e.removeFromGraph();
    });
    performance.measure('remove', '4');
}
