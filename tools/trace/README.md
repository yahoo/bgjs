# bg-trace

Record what a Behavior Graph does, event by event, then read it back:

- **as text**: what started each event, which behaviors ran in what order and *because of which
  changed demands*, what they updated, which side effects ran. Written for agents and terminals.
- **as a Mermaid diagram** of the graph, with the behaviors that ran in an event numbered.
- **as a standalone HTML replay**: step forwards and backwards through each event and watch
  updates, activations, runs and side effects move through the graph. One file, no server.

This is a development tool, not part of the library. It reads library internals and overrides a
few methods on the one `Graph` instance you give it; it does not import `behavior-graph`, changes
nothing else, and `stop()` puts the graph back.

## Quick start

From this folder (build the library at the repository root first: `npm install && npm run build`):

```bash
npm install
node bin/bg-trace.js examples/thermostat.mjs                 # text explanation to stdout
node bin/bg-trace.js examples/rooms.mjs --html rooms.html    # replay in a browser
npm test
```

Part of the output for the thermostat example:

```
Event 4: ▼ pressed while a reading arrives
  action: down fired
  action: currentTemp = 68
  1. Set the target  (because down changed)
      updates desiredTemp = 68
  2. Decide whether to heat  (because desiredTemp and currentTemp changed)
  3. Show the display  (because desiredTemp and currentTemp changed)
      queues a side effect "display"
  then side effects ran: "display" from Show the display
```

## Scenario scripts and the CLI

A scenario is an ES module whose default export gets `{ trace }` and drives a graph:

```js
import * as bg from 'behavior-graph';

export default function scenario({ trace }) {
  const graph = new bg.Graph();
  const tracer = trace(graph);                       // start recording before adding extents
  const t = new Thermostat(graph);
  tracer.nameBehaviors(t, ['Set the target', 'Decide whether to heat']);   // optional
  t.addToGraphWithAction('start');
  graph.action(() => t.up.update(), '▲ pressed');    // the debugName labels the event
}
```

```
bg-trace <scenario.mjs> [--html out.html] [--json out.json] [--mermaid] [--model] [--title "..."] [--quiet]
         [--only <extents>] [--events <actions>] [--touching <resources>] [--no-startup]
bg-trace --viewer viewer.html        an empty viewer that opens a dropped trace .json
```

The filter flags take comma-separated patterns: exact names, `*` wildcards, or `/regex/flags`.
They combine with any filter the scenario passes to `trace(graph, { filter })`.

If the scenario throws (a cycle, a second supplier, an undeclared read), the events up to the
failure are still reported, and the failing event ends with the library's error message.

## Filtering

On a big graph, or when you are looking for one thing, record only part of it. Left-out things
cost close to nothing: they are not formatted, snapshotted or put in the model, only counted.
The output says where something was left out, so a missing line never means "did not run":

```
Event 4: bedroom reads 61°
  … filtered out here: 1 update in Bedroom
  1. Find the coldest room  (because a filtered-out demand changed)
      updates coldest = 61
```

```js
import { traceGraph, filters } from 'behavior-graph-trace';

traceGraph(graph, { filter: filters.extents('House', 'Room*') });            // by debugName or class
traceGraph(graph, { filter: filters.events(/bedroom/i) });                    // by action name
traceGraph(graph, { filter: filters.touching('coldest', 'Bedroom.temp') });   // behaviors linked to these
traceGraph(graph, { filter: [filters.extents('House'), filters.noStartup()] });   // all must keep it

// or your own predicate, per kind (return falsy to leave something out)
traceGraph(graph, { filter: {
  extent: (d) => d.className !== 'Cell' || d.name === 'Cell7',
  effect: (d) => d.name !== 'log',
} });
```

A filter is a function (called for every kind), an object of per-kind predicates, or an array of
filters that must all keep a thing. Each predicate gets a descriptor:

| kind | descriptor | what leaving it out does |
| --- | --- | --- |
| `event` | `name` (action debugName or `withSource` label), `seq` | records nothing of that event; the next event shown says how many were skipped |
| `extent` | `name` (debugName, or class with `#2`), `className`, `extent` | leaves out its resources and behaviors |
| `resource` | `name`, `label` (`Extent.name`), `type` (`state`/`moment`), `extentName`, `className` | no updates or values; links to it are counted on the behavior |
| `behavior` | `label` (`tracer.name()`, or "sets x"), `named`, `extentName`, `className`, `demands`, `supplies` (resource descriptors) | leaves out its runs, and the updates and side effects it makes |
| `update` | a resource descriptor plus `by` (behavior descriptor or null) and `value` | leaves out that one update |
| `effect` | `name` (debugName), `type` (`effect`/`subscription`/`cleanup`), `behavior`, `extentName` | leaves out the effect and its run |

Name things and filters get easy: give extents a `debugName`, actions a name, behaviors a
`tracer.name()`, side effects a name. Resources are named after their field once the extent is
added. An event in which a filter left out everything is dropped too (pass
`keepEmptyEvents: true` to keep it). Errors are always recorded, even in a filtered-out event.

## In your own code

```js
import { traceGraph, explain, describeModel, toMermaid } from 'behavior-graph-trace';
import { toHTML } from 'behavior-graph-trace/html';     // Node only (reads the viewer files)

const tracer = traceGraph(graph, { onTrace: (t) => console.log(explain({ traces: [t], model: tracer.model() })) });
// ...run actions...
const data = tracer.toJSON();         // { model, traces } — plain JSON
explain(data);                        // all events as text
explain(data, { events: [3] });       // one event (the number after "Event")
describeModel(data.model);            // each behavior with its demands and supplies
toMermaid(data.model, { trace: data.traces[1] });
writeFileSync('trace.html', toHTML(data, { title: 'Login form' }));
tracer.stop();
```

Behaviors have no names in the library. Unnamed ones are labelled from their links ("sets heatOn",
"reacts to heatOn"). Name them with `tracer.name(behavior, 'Decide heat')` or
`tracer.nameBehaviors(extent, [...])` (declaration order). Extents are named by `debugName`, or by
class with `#2`, `#3` for further instances. Actions are labelled by their `debugName`; for actions
without one, wrap the call in `tracer.withSource('label', () => ...)`.

## For agents

How to write a scenario, read the output, and use it to check a change or answer a question:
[`skills/behavior-graph-trace/SKILL.md`](../../skills/behavior-graph-trace/SKILL.md).

## Trace format

`tracer.toJSON()` returns `{ format: 'behavior-graph-trace', version: 2, model, traces }`.
Traces store only changes, so their size follows what each event touched, not the size of the
graph; `timeline(data)` and `valueTimeline(data)` (exported from `text.js`) rebuild the structure
and values at any point, which is what the viewer does.

- `model`: the structure at the end, with current values: `{ extents, resources, behaviors,
  hidden? }`. Resources have `id, name, label, kind` (`state`/`moment`), `extent, value,
  supplied`. Behaviors have `id, label, extent, demands: [{ id, type: 'demand' | 'order' |
  'trace' }], supplies: [id]`, and `hiddenDemands`/`hiddenSupplies` counts when filtered.
  `hidden.extents` counts filtered-out extents by class.
- each trace: `{ index, seq, source, before, steps, filtered? }`. `index` is unique (1, 2, 3...);
  `seq` is the graph's event sequence, which a failed event reuses. `before` has `values` (only
  those that differ from the replayed state), `structure` (a change made between events) and
  `skipped` (events not recorded since the previous trace).
- a structure change is `{ set: { extents?, resources?, behaviors? }, remove?: [id],
  hiddenExtents?: { added, removed } }`: entries added or replaced, and ids removed.
- steps, in the order they happened: `action`, `update {res, value, by}` (`by` is null inside the
  action), `activate {beh, via}` (`via`: the demand that activated it), `run {beh, why,
  whyHidden?}` (`why`: the demands that had updated), `relink {beh}`, `effect {id, beh, name,
  type?, extent?}` (queued; `type` is `subscription` or `cleanup` for those), `effectRun` (same
  fields), `structure {set, remove}`, `hidden {runs?, updates?, effects?, in}` (what a filter
  left out here, by extent), `error {message}`.

Values are short display strings, not the values themselves. They are read without calling
getters (an accessor shows as `(getter)`) and a value that cannot be read shows as
`(unreadable)`, so tracing never changes what the program does.

Version 1 traces (whole models in `before.model` and `structure.model`, full `before.values`)
still open in the viewer and `explain`.

## Files

| Path | What it is |
| --- | --- |
| `src/tracer.js` | `traceGraph(graph)`: the recorder |
| `src/filter.js` | `filters` (ready-made filters), `matches`, `compileFilter` |
| `src/text.js` | `explain`, `describeModel`, `timeline`, `valueTimeline` |
| `src/mermaid.js` | `toMermaid` |
| `src/html.js` | `toHTML`: inlines the viewer and data into one file |
| `viewer/` | the replay page: graph layout (`graphview.js`), player (`player.js`), styles |
| `bin/bg-trace.js` | the CLI |
| `bench/large-graph.mjs` | tracing cost on a 5,000-extent graph, unfiltered and filtered |
| `examples/` | `thermostat.mjs` (several inputs in one event, side effects), `rooms.mjs` (extents added and removed, dynamic demands) |
