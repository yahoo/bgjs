// Plain-text views of traces, written for an agent (or a person) reading a terminal:
// what started each event, which behaviors ran in what order and why, what they changed,
// and which side effects ran afterwards. Also the helpers that rebuild the structure and values
// at any point of a trace (the viewer uses them too), since traces store only changes.

const EMPTY = { extents: [], resources: [], behaviors: [] };

/**
 * A structure after applying one structure change. Version 2 traces store `{ set, remove }`
 * diffs; version 1 stored a whole `model`.
 */
export function applyStructure(model, change) {
  if (!change) return model;
  if (change.model) return change.model;
  model = model ?? EMPTY;
  const remove = new Set(change.remove ?? []);
  const out = {};
  for (const k of ['extents', 'resources', 'behaviors']) {
    const m = new Map();
    for (const x of model[k]) if (!remove.has(x.id)) m.set(x.id, x);
    for (const x of change.set?.[k] ?? []) m.set(x.id, x);
    out[k] = [...m.values()];
  }
  const hidden = (model.hiddenExtents ?? 0) + (change.hiddenExtents?.added ?? 0) - (change.hiddenExtents?.removed ?? 0);
  if (hidden) out.hiddenExtents = hidden;
  return out;
}

/**
 * The structure at every point of a trace: `start[i]` when trace i started, `pre[i]` before
 * the changes made between the previous event and trace i, and `after[i].get(j)` after its
 * structure step j.
 */
export function timeline(data) {
  const v1 = (data.version ?? 1) < 2;
  let m = v1 ? null : EMPTY;
  const start = [], after = [], pre = [];
  for (const t of data.traces) {
    if (t.before?.model) m = t.before.model;
    pre.push(m ?? EMPTY);
    // without a version (some traces on their own, as onTrace gives them) start from data.model
    if (t.before?.structure) m = applyStructure(m ?? data.model, t.before.structure);
    start.push(m ?? data.model ?? EMPTY);
    const steps = new Map();
    t.steps.forEach((s, j) => { if (s.t === 'structure') { m = applyStructure(m ?? data.model, s); steps.set(j, m); } });
    after.push(steps);
  }
  return { start, after, pre };
}

/** Resolve the structure that applied when each trace started. */
export function modelsByTrace(data) {
  return timeline(data).start;
}

/**
 * Returns `at(i)`: every value (resource id -> display string) when trace i started. Traces
 * store only what changed, so this replays from the start (or the nearest checkpoint).
 */
export function valueTimeline(data, { every = 64 } = {}) {
  const traces = data.traces;
  const checkpoints = new Map();
  let at = -1, cur = {};
  const startOf = (t) => {
    const s = t.before?.structure;
    for (const id of s?.remove ?? []) delete cur[id];
    for (const r of s?.set?.resources ?? []) if (!(r.id in cur)) cur[r.id] = r.value;
    Object.assign(cur, t.before?.values ?? {});
  };
  const stepsOf = (t) => {
    for (const s of t.steps) {
      if (s.t === 'update') cur[s.res] = s.value;
      else if (s.t === 'structure') {
        for (const id of s.remove ?? []) delete cur[id];
        for (const r of s.set?.resources ?? s.model?.resources ?? []) if (!(r.id in cur)) cur[r.id] = r.value;
      }
    }
  };
  return (i) => {
    if (i < 0 || i >= traces.length) return {};
    if (i < at) {
      let c = -1;
      for (const k of checkpoints.keys()) if (k <= i && k > c) c = k;
      if (c >= 0) { at = c; cur = { ...checkpoints.get(c) }; } else { at = -1; cur = {}; }
    }
    while (at < i) {
      if (at >= 0) stepsOf(traces[at]);
      at++;
      startOf(traces[at]);
      if (at % every === 0) checkpoints.set(at, { ...cur });
    }
    return { ...cur };
  };
}

function namer(data) {
  const names = new Map();
  const add = (m) => {
    if (!m) return;
    for (const r of m.resources ?? []) names.set(r.id, r.label);
    for (const b of m.behaviors ?? []) names.set(b.id, b.label);
  };
  for (const t of data.traces) {
    add(t.before?.model);
    add(t.before?.structure?.set);
    for (const s of t.steps) if (s.t === 'structure') add(s.model ?? s.set);
  }
  add(data.model);
  return (id) => names.get(id) ?? id;
}

const eventNumber = (t) => t.index ?? t.seq;

/**
 * Describe recorded events as text.
 * @param {object} data a tracer's toJSON() (or { traces, model })
 * @param {object} [options]
 * @param {number[]} [options.events] only these events (their `index`, the number after "Event")
 */
export function explain(data, { events } = {}) {
  const { start, after, pre } = timeline(data);
  const name = namer(data);
  const out = [];
  data.traces.forEach((t, i) => {
    if (events && !events.includes(eventNumber(t))) return;
    out.push(explainTrace(t, name, start[i], after[i], pre[i]));
  });
  if (!data.traces.length) out.push('No events were recorded.');
  return out.join('\n\n');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function hiddenText(s) {
  const parts = [];
  if (s.runs) parts.push(plural(s.runs, 'behavior run'));
  if (s.updates) parts.push(plural(s.updates, 'update'));
  if (s.effects) parts.push(plural(s.effects, 'side effect'));
  const where = Object.entries(s.in ?? {});
  const shown = where.slice(0, 4).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));
  if (where.length > 4) shown.push(`${where.length - 4} more`);
  return `${parts.join(', ') || 'steps'}${shown.length ? ` in ${shown.join(', ')}` : ''}`;
}

function effectLabel(s, name) {
  if (s.type === 'subscription') return `subscription callback${s.extent ? ` (${s.extent})` : ''}`;
  if (s.type === 'cleanup') return `removal cleanups for ${s.extent ?? 'an extent'}`;
  return `${s.name ? `"${s.name}"` : 'side effect'} from ${s.beh ? name(s.beh) : 'the action'}`;
}

function explainTrace(t, name, model, afterSteps, prior) {
  const lines = [];
  const updated = new Set();     // resources updated so far in this event
  const effects = [];
  let cur = model;
  let n = 0;
  let current = null;
  const graphSeq = t.index != null && t.seq != null && t.seq !== t.index ? `  [graph event ${t.seq}]` : '';
  lines.push(`Event ${eventNumber(t)}: ${t.source}${graphSeq}${t.filtered ? '  (filtered out; shown because it failed)' : ''}`);
  if (t.before?.skipped) lines.push(`  (${plural(t.before.skipped, 'earlier event')} not shown: filtered out, or nothing the filter keeps happened)`);
  if (t.before?.structure && !t.before.structure.model) {
    lines.push(`  graph changed before this event: ${structureDiff(prior, model, t.before.structure)}`);
  }
  t.steps.forEach((s, j) => {
    switch (s.t) {
      case 'action':
        break;
      case 'update': {
        updated.add(s.res);
        if (s.extent) {
          const verb = s.value === 'true' ? ['adds', 'to'] : ['removes', 'from'];
          if (s.by) lines.push(`      ${s.by === current ? '' : name(s.by) + ' '}${verb[0]} ${s.extent} ${verb[1]} the graph`);
          else lines.push(`  action: ${verb[0]} ${s.extent} ${verb[1]} the graph`);
          break;
        }
        const what = s.value === '(fired)' ? `${s.name} fired` : `${s.name} = ${s.value}`;
        if (s.by && s.by === current) lines.push(`      updates ${what}`);
        else if (!s.by) lines.push(`  action: ${what}`);
        else lines.push(`      ${name(s.by)} updates ${what}`);
        break;
      }
      case 'activate':
        break;
      case 'run': {
        current = s.beh;
        let why;
        if (s.why) why = s.why.map(name);
        else {
          // version 1 traces: every demand that changed before it ran
          const b = cur?.behaviors.find(x => x.id === s.beh);
          why = (b ? b.demands.filter(d => d.type === 'demand' && updated.has(d.id)).map(d => d.id) : []).map(name);
        }
        why = why.map(w => String(w).endsWith('addedToGraph') ? 'it was added to the graph' : w);
        const because = becauseText(why, s.whyHidden ?? 0);
        lines.push(`  ${++n}. ${name(s.beh)}${because ? `  (${because})` : ''}`);
        break;
      }
      case 'relink':
        lines.push(`  -  ${s.beh ? name(s.beh) : 'a behavior'} gets a new list of demands`);
        break;
      case 'effect': {
        if (s.type === 'subscription') { lines.push(`  a just-updated subscription is queued${s.extent ? ` (${s.extent})` : ''}`); break; }
        const what = s.type === 'cleanup' ? `queues removal cleanups for ${s.extent ?? 'an extent'}` : `queues a side effect${s.name ? ` "${s.name}"` : ''}`;
        if (!s.beh) lines.push(`  action: ${what}`);
        else if (s.beh === current) lines.push(`      ${what}`);
        else lines.push(`      ${name(s.beh)} ${what}`);
        break;
      }
      case 'effectRun':
        effects.push(effectLabel(s, name));
        break;
      case 'structure': {
        const next = afterSteps?.get(j) ?? applyStructure(cur, s);
        lines.push(`  graph changed: ${structureDiff(cur, next, s)}`);
        cur = next;
        break;
      }
      case 'hidden':
        lines.push(`  … filtered out here: ${hiddenText(s)}`);
        break;
      case 'error':
        lines.push(`  ERROR: ${s.message}`);
        break;
    }
  });
  if (n === 0) lines.push(t.steps.some(s => s.t === 'hidden' && s.runs) ? '  no behaviors the filter keeps ran' : '  no behaviors ran');
  if (effects.length) lines.push(`  then side effects ran: ${effects.join('; ')}`);
  return lines.join('\n');
}

function becauseText(why, hidden) {
  const added = why.includes('it was added to the graph');
  const changed = why.filter(w => w !== 'it was added to the graph');
  if (hidden) changed.push(hidden === 1 ? 'a filtered-out demand' : `${hidden} filtered-out demands`);
  const parts = [];
  if (changed.length) parts.push(`because ${changed.join(' and ')} changed`);
  if (added) parts.push(changed.length ? 'and it was added to the graph' : 'because it was added to the graph');
  return parts.join(' ');
}

const listNames = (xs) => xs.length > 6 ? xs.slice(0, 6).join(', ') + `, … ${xs.length - 6} more` : xs.join(', ');

function structureDiff(a, b, change) {
  if (!a || !b) return 'links changed';
  const ids = (m, k) => new Set(m[k].map(x => x.id));
  const parts = [];
  const add = (k, word) => {
    const before = ids(a, k), after = ids(b, k);
    const shown = (x) => !String(x.label).endsWith('addedToGraph');
    const plus = b[k].filter(x => !before.has(x.id) && shown(x)).map(x => x.label);
    const minus = a[k].filter(x => !after.has(x.id) && shown(x)).map(x => x.label);
    if (plus.length) parts.push(`+${plus.length} ${word} (${listNames(plus)})`);
    if (minus.length) parts.push(`-${minus.length} ${word} (${listNames(minus)})`);
  };
  add('behaviors', 'behaviors');
  add('resources', 'resources');
  const old = new Map(a.behaviors.map(y => [y.id, y]));
  const touched = change?.set?.behaviors ?? b.behaviors;
  const relinked = touched.filter(x => {
    const o = old.get(x.id);
    return o && o.demands.map(d => d.id).join() !== x.demands.map(d => d.id).join();
  }).map(x => x.label);
  if (relinked.length) parts.push(`demands changed for ${listNames(relinked)}`);
  const newExt = new Set(a.extents.map(x => x.id));
  const within = (change?.set?.extents ?? []).filter(x => !newExt.has(x.id) && (x.hiddenResources || x.hiddenBehaviors))
    .map(x => [x.hiddenBehaviors && plural(x.hiddenBehaviors, 'behavior'), x.hiddenResources && plural(x.hiddenResources, 'resource')].filter(Boolean).join(' and ') + ` in ${x.name}`);
  if (within.length) parts.push(`filtered out: ${listNames(within)}`);
  const h = change?.hiddenExtents;
  if (h?.added) parts.push(`+${plural(h.added, 'filtered-out extent')}`);
  if (h?.removed) parts.push(`-${plural(h.removed, 'filtered-out extent')}`);
  if (!parts.length && change?.set) {
    // the earlier structure is not known (a trace explained on its own): name what the change touched
    const touchedNames = [...(change.set.behaviors ?? []), ...(change.set.resources ?? [])].map(x => x.label).filter(l => !String(l).endsWith('addedToGraph'));
    if (touchedNames.length) parts.push(`changed ${listNames(touchedNames)}`);
  }
  return parts.join('; ') || 'links changed';
}

/** Describe a graph's structure: each behavior with what it demands and supplies. */
export function describeModel(model) {
  const res = new Map(model.resources.map(r => [r.id, r]));
  const lines = [];
  const more = (n) => (n ? ` (+${n} filtered out)` : '');
  for (const ext of model.extents) {
    const bs = model.behaviors.filter(b => b.extent === ext.id);
    const rs = model.resources.filter(r => r.extent === ext.id && r.name !== 'addedToGraph');
    const hidden = [ext.hiddenResources && plural(ext.hiddenResources, 'resource'), ext.hiddenBehaviors && plural(ext.hiddenBehaviors, 'behavior')].filter(Boolean);
    lines.push(`${ext.name}${hidden.length ? `   (${hidden.join(' and ')} filtered out)` : ''}`);
    for (const r of rs) lines.push(`  ${r.kind} ${r.name}${r.value != null && r.value !== '' ? ` = ${r.value}` : ''}${r.supplied ? '' : '   (set by actions)'}`);
    for (const b of bs) {
      const dem = b.demands.map(d => (res.get(d.id)?.label ?? d.id) + (d.type === 'order' ? ' (order only)' : d.type === 'trace' ? ' (trace)' : ''));
      const sup = b.supplies.map(id => res.get(id)?.label ?? id);
      lines.push(`  behavior "${b.label}": demands ${dem.join(', ') || 'nothing'}${more(b.hiddenDemands)}; supplies ${sup.join(', ') || 'nothing'}${more(b.hiddenSupplies)}`);
    }
  }
  const hiddenExt = model.hidden?.extents;
  if (hiddenExt && Object.keys(hiddenExt).length) {
    const total = Object.values(hiddenExt).reduce((x, y) => x + y, 0);
    lines.push(`(${plural(total, 'extent')} filtered out: ${Object.entries(hiddenExt).map(([k, v]) => `${k} ×${v}`).join(', ')})`);
  } else if (model.hiddenExtents) {
    lines.push(`(${plural(model.hiddenExtents, 'extent')} filtered out)`);
  }
  return lines.join('\n');
}
