// A Mermaid flowchart of a graph's structure. Renders in GitHub, many Markdown viewers and
// claude.ai artifacts. Pass a trace to number the behaviors that ran in that event.

const esc = (s) => String(s).replace(/"/g, '#quot;');

/**
 * @param {object} model a structure snapshot (tracer.model(), or data.model)
 * @param {object} [options]
 * @param {object} [options.trace] highlight this event: ran behaviors are numbered, updated resources marked
 * @param {'LR'|'TD'} [options.direction]
 * @param {boolean} [options.hideAddedToGraph] leave out the addedToGraph startup resources (default true)
 */
export function toMermaid(model, { trace = null, direction = 'LR', hideAddedToGraph = true } = {}) {
  const lines = [`flowchart ${direction}`];
  const order = new Map();
  const updated = new Set();
  if (trace) {
    let n = 0;
    for (const s of trace.steps) {
      if (s.t === 'run' && !order.has(s.beh)) order.set(s.beh, ++n);
      if (s.t === 'update') updated.add(s.res);
    }
  }
  const hidden = new Set(hideAddedToGraph ? model.resources.filter(r => r.name === 'addedToGraph').map(r => r.id) : []);
  const multi = model.extents.length > 1;
  const resLine = (r) => {
    const text = esc(r.value !== '' && r.kind === 'state' ? `${r.name}<br/>${r.value}` : r.name);
    return r.kind === 'moment' ? `${r.id}(["${text}"])` : `${r.id}["${text}"]`;
  };
  const behIds = new Set(model.behaviors.map(b => b.id));
  for (const ext of model.extents) {
    const rs = model.resources.filter(r => r.extent === ext.id && !hidden.has(r.id));
    const bs = model.behaviors.filter(b => b.extent === ext.id);
    if (multi) lines.push(`  subgraph ${ext.id}["${esc(ext.name)}"]`);
    const pad = multi ? '    ' : '  ';
    for (const r of rs) lines.push(pad + resLine(r));
    for (const b of bs) {
      const label = order.has(b.id) ? `${order.get(b.id)}. ${b.label}` : b.label;
      lines.push(`${pad}${b.id}[["${esc(label)}"]]`);
    }
    if (multi) lines.push('  end');
  }
  // only draw edges between nodes in this model: a filtered trace, or a demand on a resource
  // whose extent was just removed, can name ids that are not here
  const present = new Set(model.resources.filter(r => !hidden.has(r.id)).map(r => r.id));
  const missing = [];
  for (const b of model.behaviors) {
    for (const d of b.demands) {
      if (hidden.has(d.id)) continue;
      if (!present.has(d.id)) { missing.push(d.id); continue; }
      lines.push(d.type === 'demand' ? `  ${d.id} --> ${b.id}` : `  ${d.id} -. ${d.type} .-> ${b.id}`);
    }
    for (const s of b.supplies) {
      if (present.has(s)) lines.push(`  ${b.id} ==> ${s}`); else missing.push(s);
    }
    if (b.hiddenDemands || b.hiddenSupplies) lines.push(`  %% ${b.id}: ${b.hiddenDemands ?? 0} demands and ${b.hiddenSupplies ?? 0} supplies filtered out`);
  }
  if (missing.length) lines.push(`  %% ${missing.length} links to resources not in this model left out`);
  const hiddenExt = model.hidden?.extents ? Object.values(model.hidden.extents).reduce((a, b) => a + b, 0) : (model.hiddenExtents ?? 0);
  if (hiddenExt) lines.push(`  filtered_note["${hiddenExt} extent${hiddenExt === 1 ? '' : 's'} filtered out"]`);
  lines.push('  classDef state fill:#eef4fb,stroke:#2b67ad,color:#16202a');
  lines.push('  classDef moment fill:#f5effc,stroke:#7a4bbf,color:#16202a,stroke-dasharray:4 3');
  lines.push('  classDef behavior fill:#1c2733,stroke:#1c2733,color:#f3f6f8');
  lines.push('  classDef ran fill:#dc5a16,stroke:#dc5a16,color:#ffffff');
  lines.push('  classDef changed stroke:#dc5a16,stroke-width:3px');
  const byKind = (k) => model.resources.filter(r => r.kind === k && !hidden.has(r.id)).map(r => r.id);
  const cls = (ids, c) => { if (ids.length) lines.push(`  class ${ids.join(',')} ${c}`); };
  cls(byKind('state'), 'state');
  cls(byKind('moment'), 'moment');
  cls(model.behaviors.filter(b => !order.has(b.id)).map(b => b.id), 'behavior');
  cls([...order.keys()].filter(id => behIds.has(id)), 'ran');
  cls([...updated].filter(id => !hidden.has(id) && model.resources.some(r => r.id === id)), 'changed');
  return lines.join('\n');
}
