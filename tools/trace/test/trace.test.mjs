import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bg from 'behavior-graph';
import { traceGraph, explain, describeModel, toMermaid } from '../src/index.js';
import { toHTML } from '../src/html.js';
import thermostat from '../examples/thermostat.mjs';
import rooms from '../examples/rooms.mjs';

function record(scenario) {
  let tracer;
  scenario({ trace: (g) => (tracer = traceGraph(g)) });
  return tracer;
}

const runs = (trace, data) => {
  const names = new Map(data.model.behaviors.map(b => [b.id, b.label]));
  return trace.steps.filter(s => s.t === 'run').map(s => names.get(s.beh));
};

test('records each event: what ran, in order, and the effects', () => {
  const tracer = record(thermostat);
  const data = tracer.toJSON();
  assert.equal(data.traces.length, 4);
  assert.deepEqual(data.traces.map(t => t.source), ['start', '▲ pressed', 'sensor reads 69.5°', '▼ pressed while a reading arrives']);
  assert.deepEqual(runs(data.traces[1], data), ['Set the target', 'Decide whether to heat', 'Show the display']);
  assert.deepEqual(data.traces[2].steps.filter(s => s.t === 'effectRun').map(s => s.name), ['display', 'furnace']);
  // the event's starting values are kept so a viewer can show any step
  const desired = data.model.resources.find(r => r.name === 'desiredTemp').id;
  assert.equal(data.traces[1].before.values[desired], '68');
});

test('explains a behavior that ran because several inputs changed together', () => {
  const text = explain(record(thermostat).toJSON());
  assert.match(text, /Event 4: ▼ pressed while a reading arrives/);
  assert.match(text, /Decide whether to heat {2}\(because desiredTemp and currentTemp changed\)/);
  assert.match(text, /then side effects ran: "display" from Show the display/);
});

test('records structure changes as extents come and go', () => {
  const data = record(rooms).toJSON();
  const add = data.traces.find(t => t.source === 'install bedroom sensor');
  assert.ok(add.steps.some(s => s.t === 'relink'));
  const last = add.steps.filter(s => s.t === 'structure').at(-1).model;
  const coldest = last.behaviors.find(b => b.label === 'Find the coldest room');
  const labels = coldest.demands.map(d => last.resources.find(r => r.id === d.id)?.label);
  assert.ok(labels.includes('Bedroom.temp'), labels.join());
  assert.match(explain(data), /removes Bedroom from the graph/);
  assert.doesNotMatch(describeModel(data.model), /Bedroom/);
});

test('records the error when the graph refuses a change', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class Bad extends bg.Extent {
    constructor(graph) {
      super(graph);
      this.a = this.state(1);
      this.b = this.state(2);
      this.behavior().demands(this.a).supplies(this.b).runs(() => {});
      this.behavior().demands(this.b).supplies(this.a).runs(() => {});
    }
  }
  assert.throws(() => new Bad(g).addToGraphWithAction('add'), /cycle/);
  const last = tracer.traces.at(-1);
  assert.equal(last.steps.at(-1).t, 'error');
  assert.match(explain(tracer.toJSON()), /ERROR: Behavior dependency cycle/);
});

test('stop() leaves the graph as it was', () => {
  const g = new bg.Graph();
  const before = Object.keys(g);
  const tracer = traceGraph(g);
  class E extends bg.Extent { constructor(graph) { super(graph); this.x = this.state(0); this.behavior().demands(this.x).runs(() => {}); } }
  const e = new E(g);
  e.addToGraphWithAction();
  tracer.stop();
  assert.deepEqual(Object.keys(g).filter(k => !before.includes(k)), []);
  g.action(() => e.x.update(1));
  assert.equal(tracer.traces.length, 1);
  assert.throws(() => { traceGraph(g); traceGraph(g); }, /already being traced/);
});

test('mermaid numbers the behaviors that ran in an event', () => {
  const data = record(thermostat).toJSON();
  const m = toMermaid(data.model, { trace: data.traces[1] });
  assert.match(m, /^flowchart LR/);
  assert.match(m, /\[\["1\. Set the target"\]\]/);
  assert.doesNotMatch(m, /addedToGraph/);
});

test('the HTML replay inlines the data safely', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent { constructor(graph) { super(graph); this.s = this.state(''); this.behavior().demands(this.s).runs(() => {}); } }
  const e = new E(g);
  e.addToGraphWithAction();
  g.action(() => e.s.update('</script><b>x'));
  const html = toHTML(tracer.toJSON(), { title: 'test' });
  assert.equal(html.match(/<\/script>/g).length, 3);   // only the page's own script tags close
  assert.match(html, /BGTracePlayer\.mount/);
  assert.match(toHTML(null), /Drop a trace file|mountEmpty/);
});
