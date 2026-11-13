// A thermostat: buttons change the target, a sensor reports the room temperature, one behavior
// decides whether to heat, and side effects drive the furnace and the display.
//
//   node bin/bg-trace.js examples/thermostat.mjs --html thermostat.html
import * as bg from 'behavior-graph';

class Thermostat extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.up = this.moment();
    this.down = this.moment();
    this.desiredTemp = this.state(68);
    this.currentTemp = this.state(66);
    this.heatOn = this.state(false);

    this.behavior()
      .demands(this.up, this.down)
      .supplies(this.desiredTemp)
      .runs(() => {
        if (this.up.justUpdated) this.desiredTemp.update(this.desiredTemp.value + 1);
        if (this.down.justUpdated) this.desiredTemp.update(this.desiredTemp.value - 1);
      });

    this.behavior()
      .demands(this.desiredTemp, this.currentTemp, this.addedToGraph)
      .supplies(this.heatOn)
      .runs(() => {
        this.heatOn.update(this.currentTemp.value < this.desiredTemp.value);
      });

    this.behavior()
      .demands(this.heatOn)
      .runs(() => {
        this.sideEffect(() => { /* turn the furnace on or off */ }, 'furnace');
      });

    this.behavior()
      .demands(this.desiredTemp, this.currentTemp, this.heatOn, this.addedToGraph)
      .runs(() => {
        this.sideEffect(() => { /* redraw the display */ }, 'display');
      });
  }
}

/** bg-trace calls this with `trace(graph)`, which starts recording and returns the tracer. */
export default function scenario({ trace }) {
  const graph = new bg.Graph();
  const tracer = trace(graph);
  const t = new Thermostat(graph);
  tracer.nameBehaviors(t, ['Set the target', 'Decide whether to heat', 'Drive the furnace', 'Show the display']);
  t.addToGraphWithAction('start');

  graph.action(() => t.up.update(), '▲ pressed');
  graph.action(() => t.currentTemp.update(69.5), 'sensor reads 69.5°');
  graph.action(() => { t.down.update(); t.currentTemp.update(68); }, '▼ pressed while a reading arrives');
}
