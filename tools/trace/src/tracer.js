// Records what one Graph does, event by event: the action that started each event, every
// resource update, which behaviors that activated, the order they ran in, the side effects they
// queued and when those ran, and structure changes (extents added or removed, demands relinked).
//
// It works by overriding a few methods on the graph *instance* (not the class), so it needs no
// import of behavior-graph, only affects the graph you pass, and `stop()` puts everything back.
// It reads some library internals; it is a development tool, not part of the library's API.

const INTERNAL_PREFIX = '(BG';
const MAX_VALUE = 60;

/**
 * Start recording a graph. Call it before adding extents so every extent is seen.
 * (Extents added earlier are picked up the first time one of their resources updates.)
 *
 * @param {object} graph a behavior-graph Graph
 * @param {object} [options]
 * @param {(trace: object) => void} [options.onTrace] called after each event completes
 * @param {number} [options.maxValueLength] values are shown as short strings, cut to this length
 * @returns {Tracer}
 */
export function traceGraph(graph, options = {}) {
  return new Tracer(graph, options);
}

export class Tracer {
  constructor(graph, { onTrace = null, maxValueLength = MAX_VALUE } = {}) {
    if (graph.__bgTracer) throw new Error('This graph is already being traced; call stop() on the existing tracer first.');
    this.graph = graph;
    this.onTrace = onTrace;
    this.maxValueLength = maxValueLength;
    /** Completed events, in order. */
    this.traces = [];
    this.extents = new Set();
    this.labels = new WeakMap();
    this.ids = new WeakMap();
    this.nextId = 1;
    this.extentNames = new WeakMap();
    this.classCounts = new Map();
    this.steps = [];
    this.depth = 0;
    this.before = new Map();        // event sequence -> snapshot at its start
    this.lastModelKey = null;
    this.dirty = false;
    this.effectSeq = 0;
    this.source = null;
    this.root = null;
    this.restore = [];
    graph.__bgTracer = this;
    this.install();
  }

  // ------------------------------------------------------------------ public API

  /** Give a behavior a readable name (shown instead of "sets x, y"). Returns the behavior. */
  name(behavior, label) {
    this.labels.set(behavior, label);
    return behavior;
  }

  /** Name an extent's behaviors in the order they were declared (internal ones are skipped). */
  nameBehaviors(extent, labels) {
    userBehaviors(extent).forEach((b, i) => { if (labels[i] != null) this.labels.set(b, labels[i]); });
    return extent;
  }

  /** Label the next action(s) started inside `fn`, for actions created without a debugName. */
  withSource(label, fn) {
    const prev = this.source;
    this.source = label;
    try { return fn(); } finally { this.source = prev; }
  }

  /** The current graph structure with current values. */
  model() {
    return this.extractModel();
  }

  /** Everything recorded, as plain JSON-safe data. */
  toJSON() {
    return { format: 'behavior-graph-trace', version: 1, model: this.extractModel(), traces: this.traces };
  }

  /** Stop recording and remove the overrides from the graph. */
  stop() {
    for (const undo of this.restore.reverse()) undo();
    this.restore = [];
    delete this.graph.__bgTracer;
  }

  // ------------------------------------------------------------------ naming

  idOf(obj) {
    if (!this.ids.has(obj)) this.ids.set(obj, 'n' + this.nextId++);
    return this.ids.get(obj);
  }

  extentName(ext) {
    if (!ext) return 'extent';
    if (ext.debugName) return ext.debugName;
    if (!this.extentNames.has(ext)) {
      const cls = ext.constructor?.name || 'Extent';
      const n = (this.classCounts.get(cls) ?? 0) + 1;
      this.classCounts.set(cls, n);
      this.extentNames.set(ext, n === 1 ? cls : `${cls}#${n}`);
    }
    return this.extentNames.get(ext);
  }

  resourceName(r) {
    if (r.debugName != null) return r.debugName;
    const ext = r.extent;
    if (ext) for (const key in ext) if (ext[key] === r) return key;
    return 'resource';
  }

  resourceLabel(r) {
    const name = this.resourceName(r);
    return r.extent && r.extent !== this.root ? `${this.extentName(r.extent)}.${name}` : name;
  }

  behaviorLabel(b) {
    if (this.labels.has(b)) return this.labels.get(b);
    const sup = linked(b, 'supplies').filter(r => !isInternal(r)).map(r => this.resourceName(r));
    if (sup.length) return 'sets ' + shortList(sup);
    const dem = linked(b, 'demands').filter(r => !isInternal(r) && this.resourceName(r) !== 'addedToGraph').map(r => this.resourceName(r));
    return 'reacts to ' + shortList(dem.length ? dem : ['addedToGraph']);
  }

  // ------------------------------------------------------------------ values

  valueOf(r) {
    if ('_happened' in r) return r._happened ? (r._happenedValue === undefined ? '(fired)' : this.format(r._happenedValue)) : '';
    if ('currentState' in r) return this.format(r.currentState.value);
    return '';
  }

  format(v, depth = 0) {
    let s;
    if (v === undefined) s = 'undefined';
    else if (v === null) s = 'null';
    else if (typeof v === 'number') s = Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
    else if (typeof v === 'string') s = JSON.stringify(v);
    else if (typeof v === 'boolean' || typeof v === 'bigint') s = String(v);
    else if (typeof v === 'function') s = 'ƒ';
    else if (isExtent(v)) s = this.extentName(v);
    else if (Array.isArray(v)) s = depth > 1 ? `[${v.length}]` : '[' + v.map(x => this.format(x, depth + 1)).join(', ') + ']';
    else if (v instanceof Map) s = `Map(${v.size})`;
    else if (v instanceof Set) s = `Set(${v.size})`;
    else if (typeof v === 'object') {
      if (depth > 1) s = '{…}';
      else {
        const keys = Object.keys(v);
        s = '{' + keys.slice(0, 6).map(k => `${k}: ${this.format(v[k], depth + 1)}`).join(', ') + (keys.length > 6 ? ', …' : '') + '}';
      }
    } else s = String(v);
    return s.length > this.maxValueLength ? s.slice(0, this.maxValueLength - 1) + '…' : s;
  }

  // ------------------------------------------------------------------ structure

  noteExtent(ext) {
    if (!ext || this.extents.has(ext)) return;
    this.extents.add(ext);
    if (!this.root) this.root = ext;
    this.dirty = true;
  }

  extractModel() {
    const extents = [];
    const resources = [];
    const behaviors = [];
    for (const ext of this.extents) {
      const eid = this.idOf(ext);
      extents.push({ id: eid, name: this.extentName(ext), root: ext === this.root });
      for (const r of ext.resources ?? []) {
        if (isInternal(r)) continue;
        resources.push({
          id: this.idOf(r), name: this.resourceName(r), label: this.resourceLabel(r),
          kind: kindOf(r), extent: eid, value: this.valueOf(r),
          supplied: r.suppliedBy != null,
        });
      }
      for (const b of userBehaviors(ext)) {
        const demands = [];
        for (const [r, type] of demandLinks(b)) if (!isInternal(r)) demands.push({ id: this.idOf(r), type });
        behaviors.push({
          id: this.idOf(b), label: this.behaviorLabel(b), extent: eid,
          demands, supplies: linked(b, 'supplies').filter(r => !isInternal(r)).map(r => this.idOf(r)),
        });
      }
    }
    return { extents, resources, behaviors };
  }

  values() {
    const out = {};
    for (const ext of this.extents) for (const r of ext.resources ?? []) if (!isInternal(r)) out[this.idOf(r)] = this.valueOf(r);
    return out;
  }

  modelKey(m) {
    return m.resources.map(r => r.id).join() + '|' + m.behaviors.map(b => b.id + ':' + b.demands.map(d => d.id + d.type).join('.') + '>' + b.supplies.join('.')).join();
  }

  // ------------------------------------------------------------------ recording

  push(step, seq = undefined) {
    step.seq = seq !== undefined ? seq : (this.graph.currentEvent?.sequence ?? this.lastSeq ?? null);
    if (step.seq != null) this.lastSeq = step.seq;
    if (step.seq != null && !this.before.has(step.seq)) {
      // first step of an event: snapshot structure and values as they were when it started
      this.before.set(step.seq, this.snapshot());
    }
    this.steps.push(step);
    return step;
  }

  snapshot() {
    const model = this.extractModel();
    const key = this.modelKey(model);
    const snap = { values: this.values() };
    if (key !== this.lastModelKey) { snap.model = model; this.lastModelKey = key; }
    this.dirty = false;
    return snap;
  }

  structureStep() {
    const model = this.extractModel();
    const key = this.modelKey(model);
    if (key !== this.lastModelKey) {
      this.lastModelKey = key;
      this.push({ t: 'structure', model });
    }
    this.dirty = false;
  }

  flush(error) {
    if (this.dirty && this.steps.length) this.structureStep();
    const bySeq = new Map();
    for (const s of this.steps) {
      if (!bySeq.has(s.seq)) bySeq.set(s.seq, []);
      bySeq.get(s.seq).push(s);
    }
    this.steps = [];
    const done = [];
    for (const [seq, steps] of bySeq) {
      const action = steps.find(s => s.t === 'action');
      const trace = {
        seq, source: action?.name ?? 'action',
        before: this.before.get(seq) ?? { values: {} },
        steps: steps.map(({ seq: _, ...rest }) => rest),
      };
      this.before.delete(seq);
      done.push(trace);
    }
    if (error && done.length) done[done.length - 1].steps.push({ t: 'error', message: String(error.message ?? error).split('\n')[0] });
    for (const t of done) {
      this.traces.push(t);
      if (this.onTrace) this.onTrace(t);
    }
  }

  install() {
    const g = this.graph;
    const tr = this;
    const override = (name, make) => {
      const had = Object.prototype.hasOwnProperty.call(g, name);
      const prev = g[name];
      const orig = prev.bind(g);
      g[name] = make(orig);
      this.restore.push(() => { if (had) g[name] = prev; else delete g[name]; });
    };

    const wrapAction = (orig) => function (action) {
      const block = action.block;
      const label = action.debugName ?? tr.source ?? 'action';
      action.block = (ext) => {
        tr.push({ t: 'action', name: label });
        return block(ext);
      };
      return orig(action);
    };
    override('actionHelper', wrapAction);
    override('actionAsyncHelper', wrapAction);

    override('eventLoop', (orig) => function () {
      tr.depth++;
      let error = null;
      try { return orig(); } catch (e) { error = e; throw e; } finally {
        tr.depth--;
        if (tr.depth === 0) tr.flush(error);
      }
    });

    override('resourceTouched', (orig) => function (resource) {
      if (g.currentEvent != null && !isInternal(resource)) {
        tr.noteExtent(resource.extent);
        const by = g.currentBehavior;
        const step = { t: 'update', res: tr.idOf(resource), name: tr.resourceLabel(resource), value: tr.valueOf(resource), by: by ? tr.idOf(by) : null };
        if (tr.resourceName(resource) === 'addedToGraph') step.extent = tr.extentName(resource.extent);
        tr.push(step);
      }
      return orig(resource);
    });

    override('activateBehavior', (orig) => function (behavior, sequence) {
      const fresh = behavior.enqueuedWhen == null || behavior.enqueuedWhen < sequence;
      tr.wrapBlock(behavior);
      const out = orig(behavior, sequence);
      if (fresh && !isRelinker(behavior)) {
        tr.noteExtent(behavior.extent);
        let via = null;
        for (let i = tr.steps.length - 1; i >= 0; i--) if (tr.steps[i].t === 'update') { via = tr.steps[i].res; break; }
        tr.push({ t: 'activate', beh: tr.idOf(behavior), via });
      }
      return out;
    });

    override('sideEffectHelper', (orig) => function (effect) {
      if (g.currentEvent == null) return orig(effect);
      const id = 'e' + (++tr.effectSeq);
      const beh = effect.behavior ? tr.idOf(effect.behavior) : null;
      const name = effect.debugName ?? null;
      const block = effect.block;
      effect.block = (ext) => {
        tr.push({ t: 'effectRun', id, beh, name });
        return block(ext);
      };
      tr.push({ t: 'effect', id, beh, name });
      return orig(effect);
    });

    override('addExtent', (orig) => function (extent) {
      const out = orig(extent);
      tr.noteExtent(extent);
      for (const b of extent.behaviors ?? []) tr.wrapBlock(b);
      return out;
    });

    override('removeExtent', (orig) => function (extent) {
      const out = orig(extent);
      if (tr.extents.delete(extent)) tr.dirty = true;
      return out;
    });
  }

  wrapBlock(b) {
    if (b.__bgTraced === this) return;
    const orig = b.__bgOrigBlock ?? b.block;
    b.__bgOrigBlock = orig;
    b.__bgTraced = this;
    const tr = this;
    b.block = function (ext) {
      if (tr.graph.__bgTracer === tr) {
        if (tr.dirty) tr.structureStep();
        if (isRelinker(b)) {
          const owner = ownerOf(b);
          tr.push({ t: 'relink', beh: owner ? tr.idOf(owner) : null });
          const out = orig.call(this, ext);
          tr.dirty = true;   // the new links are made before the owner runs; snapshot them then
          return out;
        }
        tr.push({ t: 'run', beh: tr.idOf(b) });
      }
      return orig.call(this, ext);
    };
    this.restore.push(() => { b.block = orig; delete b.__bgTraced; delete b.__bgOrigBlock; });
  }
}

// ------------------------------------------------------------------ helpers

function isInternal(r) {
  return typeof r?.debugName === 'string' && r.debugName.startsWith(INTERNAL_PREFIX);
}

function isExtent(v) {
  return v && typeof v === 'object' && Array.isArray(v.behaviors) && Array.isArray(v.resources) && 'graph' in v;
}

function kindOf(r) {
  if ('_happened' in r) return 'moment';
  if ('currentState' in r) return 'state';
  return 'resource';
}

function shortList(names) {
  return names.length > 3 ? names.slice(0, 3).join(', ') + ', …' : names.join(', ');
}

// Resources a behavior is linked to, before or after the graph has linked them.
function linked(b, which) {
  if (which === 'supplies') {
    return [...(b.supplies ?? [...(b.untrackedSupplies ?? []), ...(b.untrackedDynamicSupplies ?? [])])].filter(Boolean);
  }
  return demandLinks(b).map(([r]) => r);
}

// [resource, 'demand' | 'order' | 'trace'] pairs
function demandLinks(b) {
  if (b.demands != null) {
    const out = [];
    for (const r of b.demands) out.push([r, b.orderingDemands?.has(r) ? 'order' : 'demand']);
    for (const r of b.traceDemands ?? []) out.push([r, 'trace']);
    return out;
  }
  return [...(b.untrackedDemands ?? []), ...(b.untrackedDynamicDemands ?? [])].filter(Boolean).map(d => {
    const r = d.resource ?? d;
    const type = d.type === 'order' || d.type === 1 ? 'order' : (d.type === 'trace' || d.type === 2 ? 'trace' : 'demand');
    return [r, type];
  });
}

// dynamicDemands/dynamicSupplies add a hidden behavior right after the real one; the two share
// an internal resource. The later-declared one is the hidden relinker.
function internalOf(b) {
  return [...linked(b, 'supplies'), ...linked(b, 'demands')].filter(isInternal);
}

function isRelinker(b) {
  if (b.__bgRelinker !== undefined) return b.__bgRelinker;
  const mine = internalOf(b);
  let result = false;
  if (mine.length) {
    const list = b.extent?.behaviors ?? [];
    const idx = list.indexOf(b);
    result = list.slice(0, idx).some(other => internalOf(other).some(r => mine.includes(r)));
  }
  b.__bgRelinker = result;
  return result;
}

function ownerOf(b) {
  const mine = internalOf(b);
  return (b.extent?.behaviors ?? []).find(o => o !== b && internalOf(o).some(r => mine.includes(r))) ?? null;
}

function userBehaviors(ext) {
  return (ext.behaviors ?? []).filter(b => !isRelinker(b));
}
