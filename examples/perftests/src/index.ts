import * as bg from "behavior-graph"
import console from "console"
import { performance, PerformanceObserver } from "perf_hooks"

class RootExtent extends bg.Extent {
    root : bg.Signal;
    addExtents: bg.Signal;
    extentAdder : bg.Signal;
    linkUpdater : bg.Signal;
    bulkResources : bg.Signal<undefined>[][] = [];
    bulkBehaviors : bg.Behavior[][] = [];
    subextents : Sub1Extent[] = [];
    width: number = 300;
    depth: number = 300;

    constructor(g: bg.Graph) {
        super(g);
        this.root = this.signal();
        this.extentAdder = this.signal();
        this.linkUpdater = this.signal();
        this.addExtents = this.signal();

        this.behavior()
            .supplies(this.extentAdder)
            .dependsOn(this.addExtents)
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
            .dependsOn(this.extentAdder)
            .runs(extent => {
                // make all the behaviors in the first row of this extent
                // depend on the signals in the first row of each subextent
                let newDependencies: bg.Signal[] = [];
                for (let ext of this.subextents) {
                    newDependencies.push(...ext.bulkResources[0])
                }
                for (let j = 0; j < this.width; j++) {
                    this.bulkBehaviors[0][j].setDynamicDemands(newDependencies)
                }

                // make each behavior in the last row of each subextent
                // depend on each signal in the last row of this extent
                let allSupplied: bg.Signal[] = this.bulkResources[this.depth - 1];
                for (let ext of this.subextents) {
                    for (let j = 0; j < ext.width; j++) {
                        ext.bulkBehaviors[ext.depth - 1][j].setDynamicDemands(allSupplied);
                    }
                }
            });

        let previousRow: bg.Signal[] = [];
        for (let i = 0; i < this.depth; i++) {
            this.bulkResources[i] = [];
            this.bulkBehaviors[i] = [];
            let dependencies = [this.root, this.linkUpdater].concat(previousRow);
            for (let j = 0; j < this.width; j++) {
                let signal: bg.Signal<undefined> = this.signal();
                this.bulkResources[i][j] = signal;
                this.bulkBehaviors[i][j] = this.behavior()
                    .supplies(signal)
                    .dependsOn(...dependencies)
                    .runs(ext => {
                        signal.update();
                    });
            }
            previousRow = this.bulkResources[i];
        }
    }
}

class Sub1Extent extends bg.Extent {
    bulkResources : bg.Signal[][] = [];
    bulkBehaviors : bg.Behavior[][] = [];
    width: number = 10;
    depth: number = 100;

    constructor(g: bg.Graph, root: bg.Signal) {
        super(g);

        let previousRow: bg.Signal[] = [];
        for (let i = 0; i < this.depth; i++) {
            this.bulkResources[i] = [];
            this.bulkBehaviors[i] = [];
            let dependencies = previousRow;
            for (let j = 0; j < this.width; j++) {
                let signal: bg.Signal<undefined> = this.signal();
                this.bulkResources[i][j] = signal;
                this.bulkBehaviors[i][j] = this.behavior()
                    .supplies(signal)
                    .dependsOn(...dependencies)
                    .runs(ext => {
                        signal.update();
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
