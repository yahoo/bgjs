// Records what one Graph does, event by event: the action that started each event, every
// resource update, which behaviors activated and why, the order they ran in, the side effects
// they queued and when those ran, and structure changes (extents added or removed, demands
// relinked).
//
// It works by overriding a few methods on the graph *instance* (not the class), so it needs no
// import of behavior-graph, only affects the graph you pass, and `stop()` puts everything back.
// It reads some library internals; it is a development tool, not part of the library's API.
//
// Cost scales with what each event touches, not with the size of the graph:
// - structure is kept per extent and rebuilt only for extents whose links changed; traces store
//   structure as diffs (`set` entries and `remove` ids), not whole models;
// - values are read only for resources updated since the last event, and an event stores only
//   the values that differ from what a reader replaying the trace already has;
// - things a filter leaves out are not formatted, snapshotted or modelled, only counted.

import { compileFilter } from './filter.js';

const INTERNAL_PREFIX = '(BG';
const MAX_VALUE = 60;
const MAX_HIDDEN_NAMES = 20;

/**
 * Start recording a graph. Call it before adding extents so every extent is seen.
 * (Extents added earlier are picked up the first time one of their resources updates.)
 *
 * @param {object} graph a behavior-graph Graph
 * @param {object} [options]
 * @param {(trace: object) => void} [options.onTrace] called after each event completes
 * @param {number} [options.maxValueLength] values are shown as short strings, cut to this length
 * @param {Function|object|Array} [options.filter] what to record; see filter.js and the README.
 *   A function gets a descriptor `{ kind, ... }` for each event, extent, resource, behavior,
 *   update and side effect and returns a falsy value to leave it out; an object gives one
 *   predicate per kind (`{ extent: d => ..., event: d => ... }`); an array combines filters.
 * @param {boolean} [options.keepEmptyEvents] keep events in which a filter hid everything
 *   (default false: they are dropped and counted on the next event shown)
 * @returns {Tracer}
 */
export function traceGraph(graph, options = {}) {
  return new Tracer(graph, options);
}

export class Tracer {
  constructor(graph, { onTrace = null, maxValueLength = MAX_VALUE, filter = null, keepEmptyEvents = false } = {}) {
    if (graph.__bgTracer) throw new Error('This graph is already being traced; call stop() on the existing tracer first.');
    this.graph = graph;
    this.onTrace = onTrace;
    this.maxValueLength = maxValueLength;
    this.filter = compileFilter(filter);
    this.keepEmptyEvents = keepEmptyEvents;
    /** Completed events, in order. */
    this.traces = [];

    // naming
    this.labels = new WeakMap();
    this.ids = new WeakMap();
    this.nextId = 1;
    this.extentNames = new WeakMap();
    this.classCounts = new Map();
    this.root = null;

    // structure
    this.extents = new Set();        // extents in the graph that the tracer has seen
    this.decisions = new WeakMap();  // extent/resource/behavior -> recorded or not
    this.frags = new Map();          // included extent -> its last recorded model entries
    this.dirty = new Set();          // included extents whose entries must be rebuilt
    this.removed = new Set();        // included extents removed since the last diff
    this.hiddenExtents = new Map();  // class name -> count of filtered-out extents in the graph
    this.hiddenDelta = { added: 0, removed: 0 };

    // values
    this.known = new Map();          // resource id -> value as a reader replaying the trace has it
    this.stale = new Set();          // resources to re-read at the next event start
    this.pending = {};               // values recorded for events that were then dropped

    // the event being recorded
    this.cur = null;
    this.curEvent = null;
    this.skipEvent = null;           // an event the filter left out
    this.skipLabel = null;
    this.skipped = 0;                // events left out since the last one recorded
    this.depth = 0;
    this.effectSeq = 0;
    this.source = null;
    this.touching = null;            // the resource whose update is activating behaviors
    this.linking = null;             // activations held while the graph relinks
    this.inSubscriptions = false;
    this.recordedErrors = new WeakSet();
    this.lastError = undefined;
    this.warned = false;

    this.restore = [];
    this.wrapped = new Map();        // behavior -> its original block
    graph.__bgTracer = this;
    this.install();
  }

  // ------------------------------------------------------------------ public API

  /** Give a behavior a readable name (shown instead of "sets x, y"). Returns the behavior. */
  name(behavior, label) {
    this.labels.set(behavior, label);
    this.decisions.delete(behavior);
    this.markDirty(behavior.extent);
    return behavior;
  }

  /** Name an extent's behaviors in the order they were declared (internal ones are skipped). */
  nameBehaviors(extent, labels) {
    userBehaviors(extent).forEach((b, i) => { if (labels[i] != null) this.name(b, labels[i]); });
    return extent;
  }

  /** Label the next action(s) started inside `fn`, for actions created without a debugName. */
  withSource(label, fn) {
    const prev = this.source;
    this.source = label;
    try { return fn(); } finally { this.source = prev; }
  }

  /** The current graph structure (what the filter keeps) with current values. */
  model() {
    const extents = [], resources = [], behaviors = [];
    for (const ext of this.extents) {
      if (!this.includeExtent(ext)) continue;
      const f = this.dirty.has(ext) || !this.frags.has(ext) ? this.buildFrag(ext) : this.frags.get(ext);
      extents.push(f.ext);
      for (const r of f.resources) resources.push({ ...r, value: this.valueOf(f.objects.get(r.id)) });
      behaviors.push(...f.behaviors);
    }
    const model = { extents, resources, behaviors };
    if (this.hiddenExtents.size) model.hidden = { extents: Object.fromEntries(this.hiddenExtents) };
    return model;
  }

  /** Everything recorded, as plain JSON-safe data. */
  toJSON() {
    return { format: 'behavior-graph-trace', version: 2, model: this.model(), traces: this.traces };
  }

  /** Stop recording and remove the overrides from the graph. */
  stop() {
    this.close();
    for (const undo of this.restore.reverse()) undo();
    this.restore = [];
    for (const [b, block] of this.wrapped) b.block = block;
    this.wrapped.clear();
    delete this.graph.__bgTracer;
  }

  // ------------------------------------------------------------------ naming

  idOf(obj) {
    if (!this.ids.has(obj)) this.ids.set(obj, 'n' + this.nextId++);
    return this.ids.get(obj);
  }

  extentName(ext) {
    if (!ext) return 'extent';
    if (ext.debugName) return String(ext.debugName);
    if (!this.extentNames.has(ext)) {
      const cls = className(ext);
      const n = (this.classCounts.get(cls) ?? 0) + 1;
      this.classCounts.set(cls, n);
      this.extentNames.set(ext, n === 1 ? cls : `${cls}#${n}`);
    }
    return this.extentNames.get(ext);
  }

  resourceName(r) {
    if (r.debugName != null) return String(r.debugName);
    const ext = r.extent;
    if (ext) {
      for (const key of Object.keys(ext)) {
        const d = Object.getOwnPropertyDescriptor(ext, key);
        if (d && 'value' in d && d.value === r) return key;
      }
    }
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
    try {
      if ('_happened' in r) return r._happened ? (r._happenedValue === undefined ? '(fired)' : this.format(r._happenedValue)) : '';
      if ('currentState' in r) return this.format(r.currentState.value);
    } catch (_) {
      return '(unreadable)';
    }
    return '';
  }

  /** A short display string for any value. Never throws and never calls a getter. */
  format(v) {
    let s;
    try { s = this.fmt(v, 0); } catch (_) { s = '(unreadable)'; }
    return s.length > this.maxValueLength ? s.slice(0, this.maxValueLength - 1) + '…' : s;
  }

  fmt(v, depth) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    switch (typeof v) {
      case 'number': return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
      case 'string': return JSON.stringify(v.length > this.maxValueLength ? v.slice(0, this.maxValueLength) : v);
      case 'boolean': case 'bigint': case 'symbol': return String(v);
      case 'function': return 'ƒ';
    }
    if (this.isExtent(v)) return this.extentName(v);
    if (Array.isArray(v)) {
      const len = own(v, 'length');
      if (depth > 1) return `[${len}]`;
      const parts = [];
      let size = 0;
      for (let i = 0; i < len; i++) {
        if (size > this.maxValueLength) { parts.push('…'); break; }
        const item = this.fmtOwn(v, String(i), depth + 1);
        parts.push(item);
        size += item.length + 2;
      }
      return '[' + parts.join(', ') + ']';
    }
    if (v instanceof Map) return `Map(${sizeOf(v, Map)})`;
    if (v instanceof Set) return `Set(${sizeOf(v, Set)})`;
    if (v instanceof Date) return Date.prototype.toISOString.call(v);
    if (depth > 1) return '{…}';
    const keys = Object.keys(v);
    return '{' + keys.slice(0, 6).map(k => `${k}: ${this.fmtOwn(v, k, depth + 1)}`).join(', ') + (keys.length > 6 ? ', …' : '') + '}';
  }

  // a property read through its descriptor, so accessors (and reactive proxies' getters) are not run
  fmtOwn(obj, key, depth) {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d) return 'undefined';
    if (!('value' in d)) return '(getter)';
    return this.fmt(d.value, depth);
  }

  isExtent(v) {
    if (this.extents.has(v)) return true;
    const b = Object.getOwnPropertyDescriptor(v, 'behaviors');
    const r = Object.getOwnPropertyDescriptor(v, 'resources');
    return !!(b && r && Array.isArray(b.value) && Array.isArray(r.value) && Object.getOwnPropertyDescriptor(v, 'graph'));
  }

  // ------------------------------------------------------------------ filtering

  ask(kind, make) {
    const fn = this.filter?.[kind];
    if (!fn) return true;
    try {
      return !!fn(make());
    } catch (e) {
      this.warn(`the ${kind} filter threw; keeping the ${kind}`, e);
      return true;
    }
  }

  includeExtent(ext) {
    if (!this.filter) return true;
    let d = this.decisions.get(ext);
    if (d === undefined) {
      d = this.ask('extent', () => ({ kind: 'extent', extent: ext, name: this.extentName(ext), className: className(ext) }));
      this.decisions.set(ext, d);
    }
    return d;
  }

  includeResource(r) {
    if (isInternal(r)) return false;
    if (!this.filter) return true;
    let d = this.decisions.get(r);
    if (d === undefined) {
      d = this.includeExtent(r.extent) && this.ask('resource', () => this.resourceInfo(r, 'resource'));
      this.decisions.set(r, d);
    }
    return d;
  }

  includeBehavior(b) {
    if (!this.filter) return true;
    let d = this.decisions.get(b);
    if (d === undefined) {
      d = this.includeExtent(b.extent) && this.ask('behavior', () => this.behaviorInfo(b));
      this.decisions.set(b, d);
    }
    return d;
  }

  resourceInfo(r, kind) {
    const ext = r.extent;
    return { kind, resource: r, name: this.resourceName(r), label: this.resourceLabel(r), type: kindOf(r), extent: ext, extentName: this.extentName(ext), className: className(ext) };
  }

  behaviorInfo(b) {
    const tr = this;
    const ext = b.extent;
    return {
      kind: 'behavior', behavior: b, label: this.behaviorLabel(b), named: this.labels.has(b),
      extent: ext, extentName: this.extentName(ext), className: className(ext),
      get demands() { return linked(b, 'demands').filter(r => !isInternal(r)).map(r => tr.resourceInfo(r, 'resource')); },
      get supplies() { return linked(b, 'supplies').filter(r => !isInternal(r)).map(r => tr.resourceInfo(r, 'resource')); },
    };
  }

  // ------------------------------------------------------------------ structure

  noteExtent(ext) {
    if (!ext || this.extents.has(ext)) return;
    this.extents.add(ext);
    if (!this.root) this.root = ext;
    if (this.includeExtent(ext)) {
      this.removed.delete(ext);
      this.dirty.add(ext);
    } else {
      const cls = className(ext);
      this.hiddenExtents.set(cls, (this.hiddenExtents.get(cls) ?? 0) + 1);
      this.hiddenDelta.added++;
    }
  }

  dropExtent(ext) {
    if (!this.extents.delete(ext)) return;
    if (this.includeExtent(ext)) {
      this.dirty.delete(ext);
      this.removed.add(ext);
    } else {
      const cls = className(ext);
      const n = (this.hiddenExtents.get(cls) ?? 1) - 1;
      if (n > 0) this.hiddenExtents.set(cls, n); else this.hiddenExtents.delete(cls);
      this.hiddenDelta.removed++;
    }
  }

  markDirty(ext) {
    if (!ext) return;
    if (!this.extents.has(ext)) {
      if (ext.addedToGraphWhen != null) this.noteExtent(ext);
      return;
    }
    if (this.includeExtent(ext)) this.dirty.add(ext);
  }

  // a behavior's links are about to change: its entry, and its filter decision, are out of date
  markBehavior(b) {
    if (this.filter) this.decisions.delete(b);
    this.markDirty(b.extent);
  }

  buildFrag(ext) {
    const eid = this.idOf(ext);
    const objects = new Map();
    const resources = [], behaviors = [];
    let hiddenResources = 0, hiddenBehaviors = 0;
    for (const r of ext.resources ?? []) {
      if (isInternal(r)) continue;
      if (!this.includeResource(r)) { hiddenResources++; continue; }
      const id = this.idOf(r);
      objects.set(id, r);
      resources.push({ id, name: this.resourceName(r), label: this.resourceLabel(r), kind: kindOf(r), extent: eid, supplied: r.suppliedBy != null });
    }
    for (const b of userBehaviors(ext)) {
      if (!this.includeBehavior(b)) { hiddenBehaviors++; continue; }
      const demands = [];
      let hd = 0, hs = 0;
      for (const [r, type] of demandLinks(b)) {
        if (isInternal(r)) continue;
        if (this.includeResource(r)) demands.push({ id: this.idOf(r), type }); else hd++;
      }
      const supplies = [];
      for (const r of linked(b, 'supplies')) {
        if (isInternal(r)) continue;
        if (this.includeResource(r)) supplies.push(this.idOf(r)); else hs++;
      }
      const entry = { id: this.idOf(b), label: this.behaviorLabel(b), extent: eid, demands, supplies };
      if (hd) entry.hiddenDemands = hd;
      if (hs) entry.hiddenSupplies = hs;
      behaviors.push(entry);
    }
    const entry = { id: eid, name: this.extentName(ext), root: ext === this.root };
    if (hiddenResources) entry.hiddenResources = hiddenResources;
    if (hiddenBehaviors) entry.hiddenBehaviors = hiddenBehaviors;
    return { ext: entry, resources, behaviors, objects };
  }

  /** What changed in the structure since the last call, as { set, remove, hiddenExtents }, or null. */
  diffStructure() {
    if (!this.dirty.size && !this.removed.size && !this.hiddenDelta.added && !this.hiddenDelta.removed) return null;
    const set = { extents: [], resources: [], behaviors: [] };
    const remove = [];
    for (const ext of this.removed) {
      const f = this.frags.get(ext);
      if (!f) continue;
      this.frags.delete(ext);
      remove.push(f.ext.id);
      for (const r of f.resources) { remove.push(r.id); this.known.delete(r.id); }
      for (const b of f.behaviors) remove.push(b.id);
    }
    this.removed.clear();
    for (const ext of this.dirty) {
      if (!this.extents.has(ext)) continue;
      const next = this.buildFrag(ext);
      const prev = this.frags.get(ext);
      this.frags.set(ext, next);
      if (!prev || key(prev.ext) !== key(next.ext)) set.extents.push(next.ext);
      const oldR = new Map((prev?.resources ?? []).map(r => [r.id, r]));
      for (const r of next.resources) {
        const old = oldR.get(r.id);
        oldR.delete(r.id);
        if (old && key(old) === key(r)) continue;
        let value = this.known.get(r.id);
        if (value === undefined) { value = this.valueOf(next.objects.get(r.id)); this.known.set(r.id, value); }
        set.resources.push({ ...r, value });
      }
      for (const id of oldR.keys()) { remove.push(id); this.known.delete(id); }
      const oldB = new Map((prev?.behaviors ?? []).map(b => [b.id, b]));
      for (const b of next.behaviors) {
        const old = oldB.get(b.id);
        oldB.delete(b.id);
        if (!old || key(old) !== key(b)) set.behaviors.push(b);
      }
      for (const id of oldB.keys()) remove.push(id);
    }
    this.dirty.clear();
    const out = {};
    const kept = {};
    for (const k of ['extents', 'resources', 'behaviors']) if (set[k].length) kept[k] = set[k];
    if (Object.keys(kept).length) out.set = kept;
    if (remove.length) out.remove = remove;
    if (this.hiddenDelta.added || this.hiddenDelta.removed) {
      out.hiddenExtents = { ...this.hiddenDelta };
      this.hiddenDelta = { added: 0, removed: 0 };
    }
    return Object.keys(out).length ? out : null;
  }

  structureStep() {
    const s = this.diffStructure();
    if (s) this.push({ t: 'structure', ...s });
  }

  // ------------------------------------------------------------------ recording

  get skipping() {
    return this.skipEvent != null && this.graph.currentEvent === this.skipEvent;
  }

  get active() {
    return this.graph.__bgTracer === this;
  }

  open(ev) {
    // values from the start of dropped events have not reached a reader yet
    const before = { values: this.pending };
    this.pending = {};
    if (this.skipped) { before.skipped = this.skipped; this.skipped = 0; }
    const structure = this.diffStructure();
    if (structure) before.structure = structure;
    for (const r of this.stale) {
      if (!this.extents.has(r.extent) || !this.includeResource(r)) continue;
      const id = this.idOf(r);
      const v = this.valueOf(r);
      if (this.known.get(id) !== v) { before.values[id] = v; this.known.set(id, v); }
    }
    this.stale.clear();
    this.cur = { index: 0, seq: ev?.sequence ?? null, source: 'action', before, steps: [] };
    this.curEvent = ev;
    this.skipEvent = null;
  }

  ensureTrace() {
    const ev = this.graph.currentEvent;
    if (!this.cur || (ev != null && ev !== this.curEvent)) {
      this.close();
      this.open(ev);
    }
  }

  push(step) {
    if (this.skipping) return null;
    this.ensureTrace();
    this.cur.steps.push(step);
    return step;
  }

  // something the filter left out happened here: count it in place
  hide(what, ext) {
    if (this.skipping) return;
    this.ensureTrace();
    const steps = this.cur.steps;
    let h = steps[steps.length - 1];
    if (h?.t !== 'hidden') { h = { t: 'hidden', in: {} }; steps.push(h); }
    h[what] = (h[what] ?? 0) + 1;
    let name = this.extentName(ext);
    if (!(name in h.in) && Object.keys(h.in).length >= MAX_HIDDEN_NAMES) name = 'others';
    h.in[name] = (h.in[name] ?? 0) + 1;
  }

  close() {
    const t = this.cur;
    if (!t) return;
    this.cur = null;
    this.curEvent = null;
    // straight onto this trace: push() would open the next event's trace if one has started
    const s = this.diffStructure();
    if (s) t.steps.push({ t: 'structure', ...s });
    const visible = t.steps.some(s => s.t !== 'action' && s.t !== 'hidden');
    if (this.filter && !visible && !this.keepEmptyEvents && !t.before.structure) {
      // nothing the filter keeps happened; count it on the next event shown
      this.skipped += 1 + (t.before.skipped ?? 0);
      Object.assign(this.pending, t.before.values);
      return;
    }
    t.index = this.traces.length + 1;
    this.traces.push(t);
    if (this.onTrace) this.onTrace(t);
  }

  recordError(e) {
    if (e !== null && typeof e === 'object') {
      if (this.recordedErrors.has(e)) return;
      this.recordedErrors.add(e);
    } else if (this.lastError === e) return;
    this.lastError = e;
    const message = String(e?.message ?? e).split('\n')[0];
    if (this.skipEvent != null) {
      // the failing event was filtered out; an error is always shown
      const ev = this.skipEvent;
      this.skipped = Math.max(0, this.skipped - 1);
      this.close();
      this.open(ev);
      this.cur.source = this.skipLabel ?? 'action';
      this.cur.filtered = true;
    }
    if (!this.cur) this.open(null);
    this.cur.steps.push({ t: 'error', message });
    this.close();
  }

  warn(message, e) {
    if (this.warned) return;
    this.warned = true;
    console.error(`bg-trace: ${message}; the trace may be incomplete.`, e);
  }

  guard(fn) {
    try { fn(); } catch (e) { this.warn('recording failed', e); }
  }

  beginEvent(label) {
    const ev = this.graph.currentEvent;
    const keep = this.ask('event', () => ({ kind: 'event', name: label, seq: ev?.sequence ?? null }));
    if (!keep) {
      this.close();
      this.skipEvent = ev;
      this.skipLabel = label;
      this.skipped++;
      return;
    }
    this.push({ t: 'action', name: label });
    this.cur.source = label;
  }

  onUpdate(r) {
    const tr = this;
    const ext = r.extent;
    if (!this.extents.has(ext)) this.noteExtent(ext);
    if (!this.includeResource(r)) { this.hide('updates', ext); return; }
    this.stale.add(r);
    if (this.skipping) return;
    const by = this.graph.currentBehavior;
    if (by && !this.includeBehavior(by)) { this.hide('updates', by.extent); return; }
    if (this.filter?.update && !this.ask('update', () => ({ ...this.resourceInfo(r, 'update'), by: by ? this.behaviorInfo(by) : null, get value() { return tr.valueOf(r); } }))) {
      this.hide('updates', ext);
      return;
    }
    const id = this.idOf(r);
    const value = this.valueOf(r);
    this.known.set(id, value);
    const step = { t: 'update', res: id, name: this.resourceLabel(r), value, by: by ? this.idOf(by) : null };
    if (this.resourceName(r) === 'addedToGraph') step.extent = this.extentName(ext);
    this.push(step);
  }

  onActivate(b) {
    this.wrapBlock(b);
    if (this.skipping || isRelinker(b) || !this.includeBehavior(b)) return;
    let via = null;
    const t = this.touching;
    if (t) via = this.includeResource(t) ? this.idOf(t) : null;
    else if (this.linking) {
      // activated while the graph linked a new demand that had already updated in this event
      for (const r of b.demands ?? []) {
        if (b.orderingDemands?.has(r) || isInternal(r) || !justUpdated(r, this.graph)) continue;
        if (this.includeResource(r)) { via = this.idOf(r); break; }
      }
    }
    const step = { t: 'activate', beh: this.idOf(b), via };
    if (this.linking) this.linking.push(step); else this.push(step);
  }

  onRun(b) {
    if (this.skipping) return;
    if (this.dirty.size || this.removed.size) this.structureStep();
    if (isRelinker(b)) {
      const owner = ownerOf(b);
      if (owner && this.includeBehavior(owner)) this.push({ t: 'relink', beh: this.idOf(owner) });
      return;
    }
    if (!this.includeBehavior(b)) { this.hide('runs', b.extent); return; }
    // the demands that updated earlier in this event: why it is running
    const why = [];
    let hidden = 0;
    for (const r of b.demands ?? []) {
      if (b.orderingDemands?.has(r) || isInternal(r) || !justUpdated(r, this.graph)) continue;
      if (this.includeResource(r)) why.push(this.idOf(r)); else hidden++;
    }
    const step = { t: 'run', beh: this.idOf(b), why };
    if (hidden) step.whyHidden = hidden;
    this.push(step);
  }

  onEffect(effect, type, owner) {
    if (this.skipping) return;
    const ext = effect.extent ?? owner?.extent ?? null;
    if (owner && !this.includeBehavior(owner)) { this.hide('effects', owner.extent); return; }
    if (type !== 'effect' && ext && !this.includeExtent(ext)) { this.hide('effects', ext); return; }
    const name = effect.debugName ?? null;
    if (this.filter?.effect && !this.ask('effect', () => ({ kind: 'effect', name, type, behavior: owner ? this.behaviorInfo(owner) : null, extent: ext, extentName: ext ? this.extentName(ext) : null }))) {
      this.hide('effects', ext);
      return;
    }
    const id = 'e' + (++this.effectSeq);
    const step = { t: 'effect', id, beh: owner ? this.idOf(owner) : null, name };
    if (type !== 'effect') { step.type = type; if (ext) step.extent = this.extentName(ext); }
    const block = effect.block;
    const tr = this;
    effect.block = function (x) {
      if (tr.active) tr.guard(() => tr.push({ ...step, t: 'effectRun' }));
      return block.call(this, x);
    };
    this.push(step);
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
      action.block = function (ext) {
        if (tr.active) tr.guard(() => tr.beginEvent(label));
        return block.call(this, ext);
      };
      return orig(action);
    };
    override('actionHelper', wrapAction);
    override('actionAsyncHelper', wrapAction);

    override('eventLoop', (orig) => function () {
      tr.depth++;
      try { return orig(); } catch (e) { tr.guard(() => tr.recordError(e)); throw e; } finally {
        tr.depth--;
        if (tr.depth === 0) tr.guard(() => tr.close());
      }
    });

    override('resourceTouched', (orig) => function (resource) {
      if (g.currentEvent != null && !isInternal(resource)) tr.guard(() => tr.onUpdate(resource));
      const prev = tr.touching;
      tr.touching = resource;
      try { return orig(resource); } finally { tr.touching = prev; }
    });

    override('activateBehavior', (orig) => function (behavior, sequence) {
      const fresh = behavior.enqueuedWhen == null || behavior.enqueuedWhen < sequence;
      const out = orig(behavior, sequence);
      if (fresh) tr.guard(() => tr.onActivate(behavior));
      return out;
    });

    // The graph links new and changed demands and supplies here, at the top of each pass of the
    // event loop, which can be after other behaviors of the same order ran. Record the structure
    // change once the links are made, then the activations linking caused.
    override('addUntrackedSupplies', (orig) => function () {
      const list = [...(g.modifiedSupplyBehaviors ?? [])];
      if (!list.length) return orig();
      tr.guard(() => { for (const b of list) { tr.markBehavior(b); for (const s of b.supplies ?? []) tr.markDirty(s.extent); } });
      const out = orig();
      tr.guard(() => { for (const b of list) for (const s of b.supplies ?? []) tr.markDirty(s.extent); });
      return out;
    });

    override('addUntrackedDemands', (orig) => function (sequence) {
      const list = g.modifiedDemandBehaviors ?? [];
      if (!list.length) return orig(sequence);
      tr.guard(() => { for (const b of list) tr.markBehavior(b); });
      const prev = tr.linking;
      tr.linking = [];
      try { return orig(sequence); } finally {
        const held = tr.linking;
        tr.linking = prev;
        tr.guard(() => {
          if (tr.skipping) return;
          tr.structureStep();
          for (const s of held) tr.push(s);
        });
      }
    });

    override('turnSubscriptionsIntoSideEffects', (orig) => function () {
      tr.inSubscriptions = true;
      try { return orig(); } finally { tr.inSubscriptions = false; }
    });

    override('sideEffectHelper', (orig) => function (effect) {
      const out = orig(effect);   // throws for an effect queued where it is not allowed
      if (g.currentEvent != null) {
        tr.guard(() => tr.onEffect(effect, tr.inSubscriptions ? 'subscription' : 'effect', tr.inSubscriptions ? null : (effect.behavior ?? g.currentBehavior)));
      }
      return out;
    });

    override('addExtent', (orig) => function (extent) {
      const out = orig(extent);
      tr.guard(() => {
        tr.noteExtent(extent);
        tr.markDirty(extent);
        for (const b of extent.behaviors ?? []) tr.wrapBlock(b);
      });
      return out;
    });

    override('removeExtent', (orig) => function (extent) {
      const queued = g.effects?.length ?? 0;
      tr.guard(() => {
        // foreign resources it supplied are no longer supplied
        for (const b of extent.behaviors ?? []) for (const s of b.supplies ?? []) if (s.extent !== extent) tr.markDirty(s.extent);
      });
      const out = orig(extent);
      tr.guard(() => {
        // removal cleanups go straight onto the effect queue, not through sideEffectHelper
        const effects = g.effects ?? [];
        for (let i = queued; i < effects.length; i++) tr.onEffect(effects[i], 'cleanup', g.currentBehavior);
        tr.dropExtent(extent);
      });
      return out;
    });
  }

  wrapBlock(b) {
    if (this.wrapped.has(b)) return;
    const orig = b.block;
    this.wrapped.set(b, orig);
    const tr = this;
    b.block = function (ext) {
      if (tr.active) tr.guard(() => tr.onRun(b));
      return orig.call(this, ext);
    };
  }
}

// ------------------------------------------------------------------ helpers

const relinkers = new WeakMap();
const owners = new WeakMap();

function key(entry) {
  return JSON.stringify(entry);
}

function own(obj, k) {
  const d = Object.getOwnPropertyDescriptor(obj, k);
  return d && 'value' in d ? d.value : 0;
}

function sizeOf(v, cls) {
  try { return Reflect.apply(Object.getOwnPropertyDescriptor(cls.prototype, 'size').get, v, []); } catch (_) { return '?'; }
}

function className(ext) {
  try { return ext?.constructor?.name || 'Extent'; } catch (_) { return 'Extent'; }
}

function isInternal(r) {
  return typeof r?.debugName === 'string' && r.debugName.startsWith(INTERNAL_PREFIX);
}

function kindOf(r) {
  if ('_happened' in r) return 'moment';
  if ('currentState' in r) return 'state';
  return 'resource';
}

// justUpdated without the library's accessor check, which would throw inside an unrelated behavior
function justUpdated(r, graph) {
  if ('_happened' in r) return !!r._happened;
  if ('currentState' in r) return r.currentState?.event === graph.currentEvent;
  return false;
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
  let result = relinkers.get(b);
  if (result !== undefined) return result;
  const mine = internalOf(b);
  result = false;
  if (mine.length) {
    const list = b.extent?.behaviors ?? [];
    const idx = list.indexOf(b);
    result = list.slice(0, idx).some(other => internalOf(other).some(r => mine.includes(r)));
  }
  relinkers.set(b, result);
  return result;
}

function ownerOf(b) {
  if (owners.has(b)) return owners.get(b);
  const mine = internalOf(b);
  const owner = (b.extent?.behaviors ?? []).find(o => o !== b && internalOf(o).some(r => mine.includes(r))) ?? null;
  owners.set(b, owner);
  return owner;
}

function userBehaviors(ext) {
  return (ext.behaviors ?? []).filter(b => !isRelinker(b));
}
