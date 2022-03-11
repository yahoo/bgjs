//
//  Copyright Yahoo 2021
//

import {Behavior, Extent, Graph, GraphEvent, Moment, State} from '../index.js';

class Extent1 extends Extent {
    constructor(graph) {
        super(graph);

        // tag-start: Behavior-1
        this.moment1 = this.moment();
        this.moment2 = this.moment();
        this.moment3 = this.moment();
        this.behavior()
            .demands(this.moment1, this.moment2)
            .supplies(this.moment3)
            .runs(ext => {
                if (ext.moment1.justUpdated || ext.moment2.justUpdatedTo(false)) {
                    ext.moment3.update();
                }
            });
        // tag-end: Behavior-1

        // tag-start: Behavior-2
        // This behavior will automatically demand the deleteButton resource of
        // the currentChild extent whenever it changes.
        this.currentChild = this.state(null);
        this.behavior()
            .dynamicDemands([this.currentChild], ext => {
                return [ext.currentChild.value?.deleteButton];
            })
            .runs(ext => {
                if (ext.currentChild.value?.deleteButton.justUpdated) {
                    // do something in response
                }
            });
        // tag-end: Behavior-2

        // tag-begin: Intro-1
        this.increment = this.moment();
        this.reset = this.moment();
        this.counter = this.state(0);

        this.behavior()
            .demands(this.increment, this.reset)
            .supplies(this.counter)
            .runs(ext => {
                if (ext.increment.justUpdated) {
                    ext.counter.update(ext.counter.value + 1);
                } else if (ext.reset.justUpdated) {
                    ext.counter.update(0);
                }
            });
        // tag-end: Intro-1
    }
}

let g = new Graph();
let ex1 = new Extent1(g);

// tag-start: Extent-1
// Define extent that toggles state on a switch
class MyExtent extends Extent {
    constructor(graph) {
        super(graph);

        this.toggleSwitch = this.moment();
        this.currentState = this.state(false);

        this.behavior()
            .demands(this.toggleSwitch)
            .supplies(this.currentState)
            .runs(ext => {
                this.currentState.update(!this.currentState.value);
            });
    }
}

// Create instance of MyExtent and add it to the graph
let myGraph = new Graph();
let main = new MyExtent(myGraph);
main.addToGraphWithAction();
// tag-end: Extent-1

// tag-start: Thermostat-1
class Thermostat extends Extent {
    constructor(graph) {
        super(graph);

        this.heatingSystem = {turnOn: function() {}}

        this.upButtonPressed = this.moment()
        this.downButtonPressed = this.moment()
        this.desiredTemperature = this.state(65);

        this.behavior()
            .supplies(this.desiredTemperature)
            .demands(this.upButtonPressed, this.downButtonPressed)
            .runs(ext => {
                if (ext.upButtonPressed.justUpdated) {
                    ext.desiredTemperature.update(ext.desiredTemperature.value + 1);
                } else if (ext.downButtonPressed.justUpdated) {
                    ext.desiredTemperature.update(ext.desiredTemperature.value - 1);
                }
            });

        this.currentTemperature = this.state(null);
        this.heatingEquipmentOn = this.state(false);

        this.behavior()
            .supplies(this.heatingEquipmentOn)
            .demands(this.desiredTemperature, this.currentTemperature)
            .runs(ext => {
                let heatingState = ext.currentTemperature.value != null &&
                    ext.desiredTemperature.value > ext.currentTemperature.value;
                ext.heatingEquipmentOn.update(heatingState);
                if (ext.heatingEquipmentOn.justUpdated) {
                    ext.sideEffect(ext => {
                        ext.heatingSystem.turnOn(ext.heatingEquipmentOn.value);
                    });
                }
            });

    }
}
// tag-end: Thermostat-1

// Example code in documentaion.
// This ensures all example code is valid.
// All changes must be copied over to documentation.
describe('API', () => {


    test('API', () => {
        expect(true).toBeTruthy();
    });
});
