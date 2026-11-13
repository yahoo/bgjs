// Regression tests for problems found in review: each one failed before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bg from 'behavior-graph';
import { traceGraph, explain, describeModel, toMermaid, modelsByTrace } from '../src/index.js';
import { fakeDom } from './fakedom.mjs';

const labelOf = (data) => {
  const names = new Map();
  for (const t of data.traces) {
    for (const s of [t.before?.structure, ...t.steps.filter(x => x.t === 'structure')]) {
      for (const b of s?.set?.behaviors ?? []) names.set(b.id, b.label);
    }
  }
  for (const b of data.model.behaviors) names.set(b.id, b.label);
  return (id) => names.get(id);
};

test('1. a relink applied after other same-order behaviors ran is still recorded', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent {
    constructor(graph) {
      super(graph);
      this.a = this.state(0);
      this.b = this.state(0);
      this.sw = this.state(false);
      this.behavior().demands(this.a).dynamicDemands([this.sw], () => this.sw.value ? [this.b] : []).runs(() => {});
      this.behavior().demands(this.sw).runs(() => {});
    }
  }
  const e = new E(g);
  tracer.nameBehaviors(e, ['Main', 'Other']);
  e.addToGraphWithAction('add');
  g.action(() => { e.b.update(5); e.sw.update(true); }, 'switch');
  const text = explain(tracer.toJSON(), { events: [2] });
  assert.match(text, /graph changed: demands changed for Main/);
  assert.match(text, /Main {2}\(because b changed\)/);
});

test('2a. removal cleanups are recorded and credited to the removal', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  const log = [];
  class Child extends bg.Extent {
    constructor(graph) {
      super(graph);
      this.debugName = 'Child';
      this.go = this.moment();
      this.behavior().demands(this.go).runs((ext) => ext.sideEffect((_, onRemove) => onRemove('t', () => log.push('cleaned')), 'start timer'));
    }
  }
  const c = new Child(g);
  c.addToGraphWithAction('add');
  c.go.updateWithAction(undefined, 'go');
  c.removeFromGraphWithAction(undefined, 'remove');
  assert.deepEqual(log, ['cleaned']);
  const data = tracer.toJSON();
  const last = data.traces.at(-1);
  const q = last.steps.find(s => s.t === 'effect');
  assert.equal(q?.type, 'cleanup');
  assert.equal(q.extent, 'Child');
  assert.ok(last.steps.some(s => s.t === 'effectRun' && s.id === q.id));
  assert.match(explain(data, { events: [3] }), /action: queues removal cleanups for Child[\s\S]*then side effects ran: removal cleanups for Child/);
});

test('2b. subscription callbacks are recorded as subscriptions, not under the last behavior', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent {
    constructor(graph) {
      super(graph);
      this.x = this.state(0);
      this.y = this.state(0);
      this.behavior().demands(this.x).supplies(this.y).runs(() => this.y.update(this.x.value + 1));
    }
  }
  const e = new E(g);
  e.addToGraphWithAction('add');
  let calls = 0;
  g.subscribeToJustUpdated([e.y], () => calls++);
  e.x.updateWithAction(1, 'set x');
  assert.equal(calls, 1);
  const data = tracer.toJSON();
  const fx = data.traces.at(-1).steps.filter(s => s.t === 'effect');
  assert.equal(fx.length, 1);
  assert.equal(fx[0].type, 'subscription');
  assert.equal(fx[0].beh, null);
  const text = explain(data, { events: [2] });
  assert.doesNotMatch(text, / {6}queues a side effect/);
  assert.match(text, /a just-updated subscription is queued/);
  assert.match(text, /then side effects ran: subscription callback/);
});

class Cell extends bg.Extent {
  constructor(graph, i) {
    super(graph);
    this.debugName = 'Cell' + i;
    this.input = this.state(0);
    this.output = this.state(0);
    this.behavior().demands(this.input).supplies(this.output).runs(() => this.output.update(this.input.value * 2));
  }
}

test('3. what an event records does not grow with the size of the graph', () => {
  const sizes = [100, 2000].map(n => {
    const g = new bg.Graph();
    const tracer = traceGraph(g);
    const cells = Array.from({ length: n }, (_, i) => new Cell(g, i));
    g.action(() => cells.forEach(c => c.addToGraph()), 'add');
    for (let e = 0; e < 20; e++) g.action(() => cells[e].input.update(e + 1), 'tick');
    const ticks = tracer.toJSON().traces.slice(2);
    return Math.max(...ticks.map(t => JSON.stringify(t).length));
  });
  assert.ok(sizes[1] <= sizes[0] + 20, `per-event size grew from ${sizes[0]} to ${sizes[1]} bytes`);
});

test('3. a viewer can still rebuild every value at the start of any event', async () => {
  const { valueTimeline } = await import('../src/text.js');
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent {
    constructor(graph) { super(graph); this.n = this.state(0); this.m = this.moment(); this.doubled = this.state(0); this.behavior().demands(this.n).supplies(this.doubled).runs(() => this.doubled.update(this.n.value * 2)); }
  }
  const e = new E(g);
  e.addToGraphWithAction('add');
  g.action(() => { e.n.update(3); e.m.update(); }, 'three');
  g.action(() => e.n.update(4), 'four');
  const data = tracer.toJSON();
  const id = (name) => data.model.resources.find(r => r.name === name).id;
  const at = valueTimeline(data);
  assert.equal(at(2)[id('doubled')], '6');
  assert.equal(at(2)[id('m')], '');          // a moment is back to not-fired at the next event
  assert.equal(at(1)[id('doubled')], '0');   // and backwards
  assert.equal(at(2)[id('n')], '3');
});

test('4. the viewer escapes event numbers and other trace text', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const data = { format: 'behavior-graph-trace', version: 2, model: { extents: [], resources: [], behaviors: [] },
    traces: [{ seq: evil, index: evil, source: 'x', before: { values: {} }, steps: [{ t: 'action', name: evil }] }] };
  const dom = fakeDom();
  dom.mount(data);
  for (const html of dom.htmlWritten()) assert.doesNotMatch(html, /<img/);
});

test('5. formatting a value never throws and never runs its getters', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent { constructor(graph) { super(graph); this.s = this.state(null); } }
  const e = new E(g);
  e.addToGraphWithAction('add');
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.doesNotThrow(() => g.action(() => e.s.update(proxy), 'revoked'));
  let reads = 0;
  const reactive = { get count() { reads++; return 1; }, plain: 2 };
  g.action(() => e.s.update(reactive), 'getter');
  g.action(() => e.s.update([reactive]), 'getter in array');
  assert.equal(reads, 0);
  const steps = tracer.traces.slice(1).map(t => t.steps.find(s => s.t === 'update').value);
  assert.equal(steps[0], '(unreadable)');
  assert.match(steps[1], /count: \(getter\), plain: 2/);
});

test('6. an activation names the demand that activated it', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class A extends bg.Extent {
    constructor(graph, name) { super(graph); this.debugName = name; this.behavior().demands(this.addedToGraph).runs(() => {}); }
  }
  const a1 = new A(g, 'A1'), a2 = new A(g, 'A2');
  g.action(() => { a1.addToGraph(); a2.addToGraph(); }, 'add both');
  const data = tracer.toJSON();
  const res = new Map(data.model.resources.map(r => [r.id, r]));
  const beh = new Map(data.model.behaviors.map(b => [b.id, b.extent]));
  const acts = data.traces[0].steps.filter(s => s.t === 'activate');
  assert.equal(acts.length, 2);
  for (const s of acts) {
    assert.equal(res.get(s.via)?.name, 'addedToGraph');
    assert.equal(res.get(s.via).extent, beh.get(s.beh));
  }
});

test('7. each trace has its own index, even after a failed event reuses a sequence', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent {
    constructor(graph) { super(graph); this.x = this.state(0); this.y = this.state(0); this.behavior().demands(this.x).supplies(this.y).runs(() => this.y.update(1)); }
  }
  const e = new E(g);
  e.addToGraphWithAction('add');
  assert.throws(() => g.action(() => e.y.update(2), 'bad'));
  g.action(() => e.x.update(1), 'good');
  const data = tracer.toJSON();
  assert.equal(data.traces[1].seq, data.traces[2].seq);
  assert.deepEqual(data.traces.map(t => t.index), [1, 2, 3]);
  const one = explain(data, { events: [3] });
  assert.match(one, /good/);
  assert.doesNotMatch(one, /bad/);
});

test('7. an error caught by user code inside a side effect is recorded', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent {
    constructor(graph) {
      super(graph);
      this.go = this.moment();
      this.x = this.state(0);
      this.y = this.state(0);
      this.behavior().demands(this.x).supplies(this.y).runs(() => this.y.update(1));
      this.behavior().demands(this.go).runs((ext) => ext.sideEffect(() => {
        try { g.action(() => ext.y.update(5), 'nested bad'); } catch (_) { /* swallowed */ }
      }));
    }
  }
  const e = new E(g);
  e.addToGraphWithAction('add');
  e.go.updateWithAction(undefined, 'go');
  const text = explain(tracer.toJSON());
  assert.match(text, /nested bad[\s\S]*ERROR: /);
});

test('7. the viewer copes with no events and with a second file', () => {
  const dom = fakeDom();
  dom.mount({ traces: [] });
  assert.match(dom.htmlWritten().join(''), /no events/i);
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent { constructor(graph) { super(graph); this.x = this.state(0); } }
  new E(g).addToGraphWithAction('add');
  dom.mount(tracer.toJSON());
  dom.mount(tracer.toJSON());
  assert.equal(dom.listeners('keydown'), 1);
  assert.equal(dom.listeners('resize'), 1);
});

test('7. stop() leaves nothing on the behaviors', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class E extends bg.Extent {
    constructor(graph) { super(graph); this.x = this.state(0); this.y = this.state(0); this.behavior().demands(this.x).dynamicDemands([this.x], () => [this.y]).runs(() => {}); }
  }
  const e = new E(g);
  const keys = e.behaviors.map(b => Object.keys(b).sort().join());
  e.addToGraphWithAction('add');
  e.x.updateWithAction(1);
  tracer.stop();
  assert.deepEqual(e.behaviors.map(b => Object.keys(b).sort().join()), keys);
});

test('outputs do not crash on a model with an edge to a node that is not in it', () => {
  const model = { extents: [{ id: 'x1', name: 'X' }], resources: [{ id: 'r1', name: 'a', label: 'a', kind: 'state', extent: 'x1', value: '1', supplied: false }],
    behaviors: [{ id: 'b1', label: 'B', extent: 'x1', demands: [{ id: 'r1', type: 'demand' }, { id: 'gone', type: 'demand' }], supplies: ['gone2'] }] };
  const data = { version: 2, model, traces: [{ index: 1, seq: 1, source: 's', before: { values: {}, structure: { set: model } }, steps: [{ t: 'run', beh: 'b1', why: ['gone'] }] }] };
  assert.doesNotThrow(() => explain(data));
  assert.doesNotThrow(() => describeModel(model));
  const m = toMermaid(model, { trace: data.traces[0] });
  assert.doesNotMatch(m, /gone/);
  assert.equal(modelsByTrace(data).length, 1);
});

test('an event started from a side effect after a structure change records each event once', () => {
  const g = new bg.Graph();
  const tracer = traceGraph(g);
  class Child extends bg.Extent { constructor(graph) { super(graph); this.debugName = 'Child'; this.v = this.state(0); } }
  class Parent extends bg.Extent {
    constructor(graph) {
      super(graph);
      this.kill = this.moment();
      this.n = this.state(0);
      this.child = new Child(graph);
      this.addChildLifetime(this.child);
      this.behavior().demands(this.kill).runs((ext) => {
        ext.child.removeFromGraph();
        ext.sideEffect(() => g.action(() => ext.n.update(1), 'follow-up'));
      });
    }
  }
  const p = new Parent(g);
  g.action(() => { p.addToGraph(); p.child.addToGraph(); }, 'add');
  p.kill.updateWithAction(undefined, 'kill');
  const data = tracer.toJSON();
  assert.deepEqual(data.traces.map(t => t.source), ['add', 'kill', 'follow-up']);
  assert.deepEqual(data.traces.map(t => t.index), [1, 2, 3]);
  assert.match(explain(data, { events: [2] }), /graph changed: -1 resources \(Child\.v\)/);
});
