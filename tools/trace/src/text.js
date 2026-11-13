// Plain-text views of traces, written for an agent (or a person) reading a terminal:
// what started each event, which behaviors ran in what order and why, what they changed,
// and which side effects ran afterwards.

/** Resolve the structure that applied when each trace started. */
export function modelsByTrace(data) {
  let model = data.model ?? null;
  // walk forward: each trace's before.model (if present) replaces the previous structure
  const out = [];
  let current = null;
  for (const t of data.traces) {
    if (t.before?.model) current = t.before.model;
    out.push(current ?? model);
    for (const s of t.steps) if (s.t === 'structure') current = s.model;
  }
  return out;
}

function namer(models) {
  const names = new Map();
  for (const m of models) {
    if (!m) continue;
    for (const r of m.resources) names.set(r.id, r.label);
    for (const b of m.behaviors) names.set(b.id, b.label);
  }
  return (id) => names.get(id) ?? id;
}

/**
 * Describe recorded events as text.
 * @param {object} data a tracer's toJSON() (or { traces, model })
 * @param {object} [options]
 * @param {number[]} [options.events] only these event sequence numbers
 */
export function explain(data, { events } = {}) {
  const models = modelsByTrace(data);
  const extra = [];
  for (const t of data.traces) for (const s of t.steps) if (s.t === 'structure') extra.push(s.model);
  const name = namer([...models, ...extra, data.model]);
  const out = [];
  data.traces.forEach((t, i) => {
    if (events && !events.includes(t.seq)) return;
    out.push(explainTrace(t, name, models[i]));
  });
  return out.join('\n\n');
}

function explainTrace(t, name, model) {
  const lines = [];
  const updated = new Set();     // resources updated so far in this event
  const effects = [];
  let cur = model;
  let n = 0;
  let current = null;
  let prevModel = model;
  lines.push(`Event ${t.seq}: ${t.source}`);
  for (const s of t.steps) {
    switch (s.t) {
      case 'action':
        break;
      case 'update': {
        updated.add(s.res);
        if (s.extent) {
          const verb = s.value === 'true' ? ['adds', 'to'] : ['removes', 'from'];
          if (s.by) lines.push(`      ${verb[0]} ${s.extent} ${verb[1]} the graph`);
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
        // every demand that changed before it ran, not just the one that woke it
        const b = cur?.behaviors.find(x => x.id === s.beh);
        const why = (b ? b.demands.filter(d => d.type === 'demand' && updated.has(d.id)).map(d => d.id) : []).map(name)
          .map(n => n.endsWith('addedToGraph') ? 'it was added to the graph' : n);
        lines.push(`  ${++n}. ${name(s.beh)}${why.length ? `  (${becauseText(why)})` : ''}`);
        break;
      }
      case 'relink':
        lines.push(`  -  ${s.beh ? name(s.beh) : 'a behavior'} gets a new list of demands`);
        break;
      case 'effect':
        lines.push(`      queues a side effect${s.name ? ` "${s.name}"` : ''}`);
        break;
      case 'effectRun':
        effects.push(`${s.name ? `"${s.name}"` : 'side effect'} from ${s.beh ? name(s.beh) : 'the graph'}`);
        break;
      case 'structure':
        lines.push(`  graph changed: ${structureDiff(prevModel, s.model)}`);
        prevModel = s.model;
        cur = s.model;
        break;
      case 'error':
        lines.push(`  ERROR: ${s.message}`);
        break;
    }
  }
  if (n === 0) lines.push('  no behaviors ran');
  if (effects.length) lines.push(`  then side effects ran: ${effects.join('; ')}`);
  return lines.join('\n');
}

function becauseText(why) {
  const added = why.includes('it was added to the graph');
  const changed = why.filter(w => w !== 'it was added to the graph');
  const parts = [];
  if (changed.length) parts.push(`because ${changed.join(' and ')} changed`);
  if (added) parts.push(changed.length ? 'and it was added to the graph' : 'because it was added to the graph');
  return parts.join(' ');
}

function structureDiff(a, b) {
  if (!a) return `${b.behaviors.length} behaviors, ${b.resources.length} resources`;
  const ids = (m, k) => new Set(m[k].map(x => x.id));
  const parts = [];
  const add = (k, word) => {
    const before = ids(a, k), after = ids(b, k);
    const shown = (x) => !String(x.label).endsWith('addedToGraph');
    const plus = b[k].filter(x => !before.has(x.id) && shown(x)).map(x => x.label);
    const minus = a[k].filter(x => !after.has(x.id) && shown(x)).map(x => x.label);
    if (plus.length) parts.push(`+${plus.length} ${word} (${plus.join(', ')})`);
    if (minus.length) parts.push(`-${minus.length} ${word} (${minus.join(', ')})`);
  };
  add('behaviors', 'behaviors');
  add('resources', 'resources');
  const relinked = b.behaviors.filter(x => {
    const old = a.behaviors.find(y => y.id === x.id);
    return old && old.demands.map(d => d.id).join() !== x.demands.map(d => d.id).join();
  }).map(x => x.label);
  if (relinked.length) parts.push(`demands changed for ${relinked.join(', ')}`);
  return parts.join('; ') || 'links changed';
}

/** Describe a graph's structure: each behavior with what it demands and supplies. */
export function describeModel(model) {
  const res = new Map(model.resources.map(r => [r.id, r]));
  const lines = [];
  const multi = model.extents.length > 1;
  for (const ext of model.extents) {
    const bs = model.behaviors.filter(b => b.extent === ext.id);
    const rs = model.resources.filter(r => r.extent === ext.id && r.name !== 'addedToGraph');
    if (multi || model.extents.length === 1) lines.push(`${ext.name}`);
    for (const r of rs) lines.push(`  ${r.kind} ${r.name}${r.value !== '' ? ` = ${r.value}` : ''}${r.supplied ? '' : '   (set by actions)'}`);
    for (const b of bs) {
      const dem = b.demands.map(d => (res.get(d.id)?.label ?? d.id) + (d.type === 'order' ? ' (order only)' : d.type === 'trace' ? ' (trace)' : ''));
      const sup = b.supplies.map(id => res.get(id)?.label ?? id);
      lines.push(`  behavior "${b.label}": demands ${dem.join(', ') || 'nothing'}; supplies ${sup.join(', ') || 'nothing'}`);
    }
  }
  return lines.join('\n');
}
