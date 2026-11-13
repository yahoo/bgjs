import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as bg from 'behavior-graph';
import { traceGraph, explain, describeModel, toMermaid, filters, matches, valueTimeline, compileFilter } from '../src/index.js';
import { toHTML } from '../src/html.js';
import rooms from '../examples/rooms.mjs';
import thermostat from '../examples/thermostat.mjs';
import { fakeDom } from './fakedom.mjs';

function record(scenario, options) {
  let tracer;
  scenario({ trace: (g) => (tracer = traceGraph(g, options)) });
  return tracer;
}

test('only some extents: the others are not formatted or modelled, and are counted', () => {
  let tracer;
  const read = [];
  rooms({
    trace: (g) => {
      tracer = traceGraph(g, { filter: filters.extents('House') });
      const valueOf = tracer.valueOf.bind(tracer);
      tracer.valueOf = (r) => { read.push(r.extent.debugName ?? r.extent.constructor.name); return valueOf(r); };
      return tracer;
    },
  });
  assert.deepEqual([...new Set(read)], ['House']);
  const data = tracer.toJSON();
  assert.deepEqual(data.model.extents.map(x => x.name), ['House']);
  assert.ok(!JSON.stringify(data).includes('Bedroom.temp'));
  assert.deepEqual(data.model.hidden, { extents: { Room: 1 } });
  const coldest = data.model.behaviors.find(b => b.label === 'Find the coldest room');
  assert.equal(coldest.hiddenDemands, 1);
  const text = explain(data);
  assert.match(text, /Event 4: bedroom reads 61°\n {2}… filtered out here: 1 update in Bedroom\n {2}1\. Find the coldest room {2}\(because a filtered-out demand changed\)/);
  assert.match(text, /graph changed: \+1 filtered-out extent/);
  assert.match(describeModel(data.model), /demands rooms \(\+1 filtered out\)/);
  assert.match(describeModel(data.model), /1 extent filtered out: Room ×1/);
});

test('only some events: the rest are counted and values still replay correctly', () => {
  const tracer = record(rooms, { filter: filters.events(/bedroom/) });
  const data = tracer.toJSON();
  assert.deepEqual(data.traces.map(t => t.source), ['install bedroom sensor', 'bedroom reads 61°', 'remove bedroom sensor']);
  assert.deepEqual(data.traces.map(t => t.index), [1, 2, 3]);
  assert.equal(data.traces[0].before.skipped, 2);
  const text = explain(data);
  assert.match(text, /Event 1: install bedroom sensor {2}\[graph event 3\]\n {2}\(2 earlier events not shown/);
  // the skipped events' changes reach the first event shown
  const start = valueTimeline(data)(0);
  const rooms_ = data.model.resources.find(r => r.name === 'rooms').id;
  assert.equal(start[rooms_], '[Living]');
});

test('only behaviors touching a resource: other behaviors and their work are counted in place', () => {
  const data = record(thermostat, { filter: filters.touching('heatOn') }).toJSON();
  assert.ok(!data.model.behaviors.some(b => b.label === 'Set the target'));
  const text = explain(data, { events: [2] });
  assert.match(text, /… filtered out here: 1 behavior run, 1 update/);
  assert.doesNotMatch(text, /Set the target/);
  assert.match(text, /1\. Decide whether to heat/);
});

test('noStartup hides the addedToGraph updates but keeps why a behavior ran', () => {
  const data = record(thermostat, { filter: filters.noStartup() }).toJSON();
  const text = explain(data, { events: [1] });
  assert.doesNotMatch(text, /adds Thermostat to the graph/);
  assert.match(text, /… filtered out here: 1 update in Thermostat/);
  assert.match(text, /Decide whether to heat {2}\(because it was added to the graph\)/);
});

test('a filter that hides everything in an event drops the event and says so', () => {
  const data = record(rooms, { filter: filters.extents('Living') }).toJSON();
  // only events where Living did something are kept
  assert.ok(data.traces.length < 5);
  assert.ok(data.traces.some(t => t.before.skipped));
  const kept = record(rooms, { filter: filters.extents('Living'), keepEmptyEvents: true }).toJSON();
  assert.equal(kept.traces.length, 5);
});

test('a single function, per-kind objects and arrays all work and combine', () => {
  const seen = new Set();
  record(thermostat, { filter: (d) => { seen.add(d.kind); return true; } });
  assert.deepEqual([...seen].sort(), ['behavior', 'effect', 'event', 'extent', 'resource', 'update']);
  const data = record(thermostat, { filter: [filters.events('▲*'), { effect: (d) => d.name !== 'display' }] }).toJSON();
  assert.deepEqual(data.traces.map(t => t.source), ['▲ pressed']);
  assert.ok(!data.traces[0].steps.some(s => s.t === 'effect'));
  assert.match(explain(data), /filtered out here: 1 side effect/);
  assert.throws(() => compileFilter({ behaviour: () => true }), /Unknown filter kind "behaviour"/);
});

test('pattern matching: exact, wildcard, regex, function', () => {
  assert.ok(matches('Room', 'Room'));
  assert.ok(!matches('Room', 'Room#2'));
  assert.ok(matches('Room*', 'Room#2'));
  assert.ok(matches(/^room/i, 'Room#2'));
  assert.ok(matches([(s) => s.length === 3, 'x'], 'abc'));
});

test('a filter that throws is reported once and keeps things', (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')));
  const data = record(thermostat, { filter: { behavior: () => { throw new Error('oops'); } } }).toJSON();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /behavior filter threw/);
  assert.equal(data.model.behaviors.length, 4);
});

test('filtered traces render as Mermaid, HTML and in the viewer', () => {
  const data = record(rooms, { filter: filters.extents('House') }).toJSON();
  const m = toMermaid(data.model, { trace: data.traces.at(-1) });
  assert.match(m, /1 extent filtered out/);
  assert.match(toHTML(data), /BGTracePlayer\.mount/);
  const dom = fakeDom();
  assert.doesNotThrow(() => dom.mount(data));
});

test('the CLI takes filter flags', () => {
  const bin = fileURLToPath(new URL('../bin/bg-trace.js', import.meta.url));
  const example = fileURLToPath(new URL('../examples/rooms.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [bin, example, '--only', 'House', '--events', '/bedroom/', '--model'], { encoding: 'utf8' });
  assert.match(out, /Event 1: install bedroom sensor/);
  assert.match(out, /filtered out here: 1 update in Bedroom/);
  assert.match(out, /1 extent filtered out: Room ×1/);
});

test('filtering a large graph to one extent keeps the trace small', () => {
  class Cell extends bg.Extent {
    constructor(graph, i) { super(graph); this.debugName = 'Cell' + i; this.input = this.state(0); this.output = this.state(0); this.behavior().demands(this.input).supplies(this.output).runs(() => this.output.update(this.input.value)); }
  }
  const g = new bg.Graph();
  const tracer = traceGraph(g, { filter: filters.extents('Cell7') });
  const cells = Array.from({ length: 2000 }, (_, i) => new Cell(g, i));
  g.action(() => cells.forEach(c => c.addToGraph()), 'add');
  for (let e = 0; e < 200; e++) g.action(() => cells[e % 100].input.update(e + 1), 'tick');
  const data = tracer.toJSON();
  assert.ok(JSON.stringify(data).length < 10_000, `${JSON.stringify(data).length} bytes`);
  assert.equal(data.traces.length, 3);   // the add, and the two ticks that touched Cell7
  assert.match(explain(data), /Event 2: tick {2}\[graph event 9\]\n {2}\(7 earlier events not shown/);
});
