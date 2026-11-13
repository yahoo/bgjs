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
  demands what it checks and throws. `checks` run on the starting state `setup()` builds and
  after every step, for properties of the whole system, including the outside world. A
  violation in the starting state is a counterexample with no steps.
- **The outside world** is part of the system: fakes for the server, timers and clock that
  side effects write to and actions deliver from. Put their state in `envKey`. If it is
  missing, two different states are merged and a bug can be missed. Replay catches most such
  mistakes ("Something is not deterministic").
- **Graphs.** Build every `Graph` in `setup()`. explore explores the graphs `setup()` runs an
  action on, builds an extent on, or returns (reachable from the system). An action during a
  step on any other graph, such as one a step creates or one shared between systems, is an
  error.
- **`bg`.** The tool imports the `behavior-graph` that this folder resolves. If your code
  imports another copy (a project's own `node_modules`), pass that module as `bg`. If you
  don't, explore sees no graph and says so, or finds an object shaped like a `Graph` or
  `Extent` that is not one of `bg`'s and says another copy is loaded.
- **Time and randomness.** While explore runs, `Date.now()`, `new Date()` with no arguments,
  `Date()` and `Math.random()` throw, anywhere: in behaviors, side effects, `run` and
  `setup()`. Inject a fixed `graph.dateProvider` or a clock object that `setup()` creates, and
  pass randomness in as an input. Graphs that keep the default `dateProvider` get one that
  returns a fixed time, so event timestamps are all the same during a search.
- **Steps are synchronous.** explore never runs async continuations, so work after an
  `await`, in a `.then` or in a timer is not explored. Model each reply or timer fire as an
  explicit action that delivers it (as `examples/search.mjs` does). A `run` or side effect
  that returns a promise, or a `.then` in `setup()` or a step, is an error. (A `run` may
  return the promise of an `actionAsync` it started.) An `await` inside an async function
  that a side effect calls without returning cannot be seen during the search; the CLI waits
  a moment afterwards and fails (exit 2) if any event ran on an explored graph then.

### What the hasher cannot see

Two states that differ only in something the hasher cannot see are merged, and a bug that
needs the difference is missed. It hashes `State` values, extents' own enumerable fields
(string or symbol keyed), and `envKey`, looking inside arrays, `Map`s, `Set`s, `Date`s, plain
objects and extents that are not in the graph yet. It cannot see:

- `#private` fields, values held in closures, `WeakMap`s and `WeakSet`s, and non-enumerable
  properties;
- anything reachable only through an object `opaque` returns true for.

Put such state in a `State`, or return it from `envKey`. Replay catches some of these
mistakes ("Something is not deterministic"), not all.

## Options and reductions

| Option | What it does |
| --- | --- |
| `depth` | Longest input sequence. Breadth first, so a counterexample is a shortest one. |
| `maxStates` | Stop after this many distinct states (`stats.truncated`). Default 1,000,000. |
| `reduction: 'sleep'` | Partial order reduction: two steps whose footprints (resources read and written, including by `enabled()` and by updates that change nothing, and the declared demands of the behaviors that ran) are disjoint commute, so only one of their orders is explored. A step that changes a plain extent field, the `envKey` state or the graph's structure is dependent on every other step, because reads of those cannot be seen. So it saves work only when steps touch disjoint graph resources; with fakes for the outside world it rarely helps. |
| `cone(sys, graphs)` | Cone of influence: the resources the properties read. Only these and what is upstream of them through declared demands are hashed, which merges states that differ elsewhere. Plain extent fields are not hashed. A `run`, side effect, `enabled()` or check that reads a resource outside the cone is an error. Still unsound if that code reads plain extent fields, or a behavior outside the cone hands a value to a side effect in a closure. |
| `mode: 'random'`, `walks`, `seed` | Random walks of length `depth` when the space is too big to search. |

`exploreTouch(key, 'read' | 'write' | 'readwrite')` marks a step as touching something outside
the graph, so that sleep sets do not treat two steps that share it as independent. It is no
longer needed for state that `envKey` returns or extents hold: a change there is seen.

Bounded search is not proof. It tests every sequence of the given inputs up to `depth`.

## CLI

```
bg-explore <spec.mjs> [--depth N] [--mode bfs|random] [--walks N] [--seed N] [--reduction none|sleep]
           [--max-states N] [--html cex.html] [--json result.json] [--no-trace] [--quiet]
```

It prints the search statistics, the counterexample and the trace of its replay. The exit
code is 0 with no violation, 1 with one, 2 when the spec could not be explored (a bad flag,
a spec error, async work), and 3 when the search stopped at `--max-states` before finding a
violation: a truncated search is not a pass.

## In your own code

```js
import { explore, replayExplore, traceCounterexample } from 'behavior-graph-explore';

const r = explore(spec);             // throws ExploreError on a spec mistake explore can detect
if (r.ok && r.stats.truncated) { /* not a pass */ }
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
| `src/explore.js` | `explore`, `replayExplore`, `exploreTouch`, `exploreLateEvents`, `ExploreError` |
| `src/replay.js` | `traceCounterexample`: replays a counterexample with `bg-trace` attached |
| `bin/bg-explore.js` | the CLI |
| `examples/search.mjs` | a search box whose late replies overwrite newer results |
| `test/soundness.test.mjs` | specs on which explore once reported no violation although one existed |

History: this started as `explore()` inside the library (branch `feature/explore`), where it
found two defects in the B5 eval that no other test reached. As a tool it gives the same
results with no library changes (same states, transitions and counterexamples on those
runs). The wrapping costs some speed: about 25% slower on the largest of those runs.
