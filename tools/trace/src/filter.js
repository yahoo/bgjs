// Filters decide what a tracer records. Everything left out is skipped before it is formatted or
// modelled, and counted where it happened, so the output says what it is not showing.
//
// A filter is one of:
// - a function, called with a descriptor for every kind of thing below; return a falsy value to
//   leave that thing out;
// - an object with one predicate per kind: { event, extent, resource, behavior, update, effect };
//   kinds without a predicate are all kept;
// - an array of filters, all of which must keep a thing (the same as `filters.all(...)`).
//
// Descriptors (what the tracer knows at each point):
//   event    { kind, name, seq }                     name: the action's debugName (or withSource label)
//   extent   { kind, extent, name, className }       name: debugName, else class name with #2, #3...
//   resource { kind, resource, name, label, type, extent, extentName, className }
//            name: debugName (the field name once the extent is added); label: "Extent.name";
//            type: 'state' | 'moment' | 'resource'
//   behavior { kind, behavior, label, named, extent, extentName, className, demands, supplies }
//            label: tracer.name() / nameBehaviors() if given, else "sets x" / "reacts to y";
//            demands, supplies: resource descriptors (computed only if read)
//   update   a resource descriptor with kind 'update', plus { by, value }: the behavior
//            descriptor that made the update (null in an action) and the new value as a string
//   effect   { kind, name, type, behavior, extent, extentName }
//            type: 'effect' | 'subscription' | 'cleanup'
//
// Leaving out an extent leaves out its resources and behaviors. Leaving out a behavior leaves out
// its runs and the updates and side effects it makes. Leaving out an event records none of it.

const KINDS = ['event', 'extent', 'resource', 'behavior', 'update', 'effect'];

/** Normalize a filter to { kind: predicate } (or null for no filter). */
export function compileFilter(f) {
  if (f == null || f === true) return null;
  if (Array.isArray(f)) return compileFilter(all(...f));
  if (typeof f === 'function') return Object.fromEntries(KINDS.map(k => [k, f]));
  if (typeof f === 'object') {
    const out = {};
    for (const [k, fn] of Object.entries(f)) {
      if (!KINDS.includes(k)) throw new TypeError(`Unknown filter kind "${k}"; use ${KINDS.join(', ')}.`);
      if (fn == null) continue;
      if (typeof fn !== 'function') throw new TypeError(`The "${k}" filter must be a function.`);
      out[k] = fn;
    }
    return Object.keys(out).length ? out : null;
  }
  throw new TypeError('A trace filter is a function, an object of per-kind functions, or an array of filters.');
}

/**
 * True if any candidate string matches any pattern. A pattern is a string (exact, or with `*`
 * wildcards), a RegExp, a function of the candidate, or an array of patterns.
 */
export function matches(patterns, ...candidates) {
  const list = Array.isArray(patterns) ? patterns.flat(Infinity) : [patterns];
  return list.some(p => candidates.some(c => c != null && matchOne(p, String(c))));
}

function matchOne(p, c) {
  if (p instanceof RegExp) { p.lastIndex = 0; return p.test(c); }
  if (typeof p === 'function') return !!p(c);
  const s = String(p);
  if (!s.includes('*')) return s === c;
  return new RegExp('^' + s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(c);
}

/** All of the filters must keep a thing. */
export function all(...fs) {
  const compiled = fs.map(compileFilter).filter(Boolean);
  if (compiled.length <= 1) return compiled[0] ?? null;
  const out = {};
  for (const k of KINDS) {
    const preds = compiled.map(c => c[k]).filter(Boolean);
    if (preds.length) out[k] = (d) => preds.every(p => p(d));
  }
  return out;
}

const resMatch = (patterns) => (r) => matches(patterns, r.label, r.name);

/** Ready-made filters; combine them with `filters.all(...)` or an array. */
export const filters = {
  all,

  /** Only these extents, by name (`'Bedroom'`) or class (`'Room'`); `*` and RegExps work. */
  extents: (...patterns) => ({ extent: (d) => matches(patterns, d.name, d.className) }),

  /** Every extent except these. */
  withoutExtents: (...patterns) => ({ extent: (d) => !matches(patterns, d.name, d.className) }),

  /** Only events whose action name matches. */
  events: (...patterns) => ({ event: (d) => matches(patterns, d.name) }),

  /** Only these resources (by name or "Extent.name" label); behaviors linked to others still show. */
  resources: (...patterns) => ({ resource: resMatch(patterns) }),

  /** Only behaviors that demand or supply a matching resource, and the work they do. */
  touching: (...patterns) => ({ behavior: (d) => d.demands.some(resMatch(patterns)) || d.supplies.some(resMatch(patterns)) }),

  /** Only these behaviors, by label (their tracer.name, or "sets x" / "reacts to y"). */
  behaviors: (...patterns) => ({ behavior: (d) => matches(patterns, d.label) }),

  /** Hide the "adds X to the graph" / "removes X" updates of each extent's addedToGraph. */
  noStartup: () => ({ update: (d) => d.name !== 'addedToGraph' }),
};

/**
 * Parse a command-line pattern list: comma-separated, `/re/flags` for a RegExp.
 * `"House,/^Room/"` -> ['House', /^Room/]
 */
export function parsePatterns(text) {
  return String(text).split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^\/(.*)\/([a-z]*)$/);
    return m ? new RegExp(m[1], m[2]) : s;
  });
}
