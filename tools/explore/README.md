# bg-explore

A bounded model checker for Behavior Graph. `explore()` runs your real graph over every
sequence of inputs up to a depth and checks properties after each step. When one fails it
returns the shortest input sequence that breaks it, and `bg-explore` replays that sequence
with [`bg-trace`](../trace) so you can read, event by event, how the graph got there.

A graph's events are deterministic, so the only nondeterminism is which input comes next.
The checker needs no model of your code; it runs the code.

This is a development tool, not part of the library. While `explore()` runs it wraps a few
library methods on the prototypes (to find the graphs `setup()` builds and to watch reads,
writes and structure changes), and it puts them back when it returns.

## Quick start

From this folder (build the library at the repository root first: `npm install && npm run build`):

```bash
npm install
node bin/bg-explore.js examples/search.mjs                 # finds a stale-reply bug, then traces it
FIXED=1 node bin/bg-explore.js examples/search.mjs         # the fixed version: no violation
node bin/bg-explore.js examples/search.mjs --html cex.html # the counterexample as a step-through replay
npm test
```

```
Violation after 4 step(s) (18 states, 24 transitions, depth 3 of 6 completed, 3 ms):
  1. type "ca"
  2. type "cat"
  3. reply "newest"
  4. reply "oldest"

  nothing pending, query is "cat", but results are ["ca-1","ca-2"]

Trace of the counterexample (setup, then one or more events per step):
...
Event 5: reply to "ca"
  action: reply = {id: 1, query: "ca", results: ["ca-1", "ca-2"]}
  1. sets results  (because reply changed)
      updates results = ["ca-1", "ca-2"]
```

## A spec

A spec is an ES module whose default export is `explore`'s options, or a function that
returns them:

```js
import * as bg from 'behavior-graph';

export default {
  bg,                                  // the behavior-graph your code imports (see below)
  setup: () => {                       // a fresh system; must be deterministic
    const server = { pending: [] };
    const s = new Search(new bg.Graph(), server);
    s.addToGraphWithAction('start');
    return s;
  },
  actions: [                           // each kind of input, with a small finite domain
    { name: 'type', inputs: ['ca', 'cat'], run: (s, q) => s.query.updateWithAction(q) },
    { name: 'reply', inputs: ['oldest', 'newest'], enabled: (s) => s.server.pending.length > 0,
      run: (s, which) => { /* deliver one pending reply as an action */ } },
  ],
  envKey: (s) => s.server.pending,     // state outside the graph that affects what happens next
  opaque: (v) => 'pending' in v,       // ...and so is not hashed again as an extent field
  checks: [(s) => { /* return a message when the property fails */ }],
  depth: 6,
};
```

- **Properties.** A step that throws is a violation, so an invariant can be a behavior that
  demands what it checks and throws. `checks` run after every step for properties of the
  whole system, including the outside world.
- **The outside world** is part of the system: fakes for the server, timers and clock that
  side effects write to and actions deliver from. Put their state in `envKey`. If it is
  missing, two different states are merged and a bug can be missed. Replay catches most such
  mistakes ("Something is not deterministic").
- **`bg`.** The tool imports the `behavior-graph` that this folder resolves. If your code
  imports another copy (a project's own `node_modules`), pass that module as `bg`. If you
  don't, explore sees no graph and says so.
- `Date.now()` and `Math.random()` throw inside a behavior while explore runs. Use
  `graph.dateProvider` or an injected clock, and pass randomness in as an input.

## Options and reductions

| Option | What it does |
| --- | --- |
| `depth` | Longest input sequence. Breadth first, so a counterexample is a shortest one. |
| `maxStates` | Stop after this many distinct states (`stats.truncated`). Default 1,000,000. |
| `reduction: 'sleep'` | Partial order reduction: two steps whose footprints (resources read and written, declared demands of the behaviors that ran, keys passed to `exploreTouch`) are disjoint commute, so only one of their orders is explored. |
| `cone(sys, graphs)` | Cone of influence: the resources the properties read. Only these and what is upstream of them through declared demands are hashed, which merges states that differ elsewhere. Sound only if the checks read nothing else. |
| `mode: 'random'`, `walks`, `seed` | Random walks of length `depth` when the space is too big to search. |

`exploreTouch(key, 'read' | 'write' | 'readwrite')` marks a step as touching something outside
the graph, so that sleep sets do not treat two steps that share it as independent.

Bounded search is not proof. It tests every sequence of the given inputs up to `depth`.

## CLI

```
bg-explore <spec.mjs> [--depth N] [--mode bfs|random] [--walks N] [--seed N] [--reduction sleep]
           [--max-states N] [--html cex.html] [--json result.json] [--no-trace] [--quiet]
```

It prints the search statistics, the counterexample and the trace of its replay. The exit
code is 0 with no violation, 1 with one, and 2 when the spec could not be explored.

## In your own code

```js
import { explore, replayExplore, traceCounterexample } from 'behavior-graph-explore';

const r = explore(spec);
if (!r.ok) {
  const { traces } = traceCounterexample(spec, r.counterexample.steps);   // one per graph
  // traces[0] goes to bg-trace's explain / toMermaid / toHTML
  const { sys } = replayExplore(spec, r.counterexample.steps);            // or inspect the system
}
```

For agents: [`skills/behavior-graph-explore/SKILL.md`](../../skills/behavior-graph-explore/SKILL.md).

## Files

| Path | What it is |
| --- | --- |
| `src/explore.js` | `explore`, `replayExplore`, `exploreTouch` |
| `src/replay.js` | `traceCounterexample`: replays a counterexample with `bg-trace` attached |
| `bin/bg-explore.js` | the CLI |
| `examples/search.mjs` | a search box whose late replies overwrite newer results |

History: this started as `explore()` inside the library (branch `feature/explore`), where it
found two defects in the B5 eval that no other test reached. As a tool it gives the same
results with no library changes (same states, transitions and counterexamples on those
runs). The wrapping costs some speed: about 25% slower on the largest of those runs.
