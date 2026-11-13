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
bg-trace --viewer viewer.html        an empty viewer that opens a dropped trace .json
```

If the scenario throws (a cycle, a second supplier, an undeclared read), the events up to the
failure are still reported, and the failing event ends with the library's error message.

## In your own code

```js
import { traceGraph, explain, describeModel, toMermaid } from 'behavior-graph-trace';
import { toHTML } from 'behavior-graph-trace/html';     // Node only (reads the viewer files)

const tracer = traceGraph(graph, { onTrace: (t) => console.log(explain({ traces: [t], model: tracer.model() })) });
// ...run actions...
const data = tracer.toJSON();         // { model, traces } — plain JSON
explain(data);                        // all events as text
explain(data, { events: [3] });       // one event
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

`tracer.toJSON()` returns `{ format: 'behavior-graph-trace', version: 1, model, traces }`.

- `model`: `{ extents, resources, behaviors }`. Resources have `id, name, label, kind`
  (`state`/`moment`), `extent, value, supplied`. Behaviors have `id, label, extent,
  demands: [{ id, type: 'demand' | 'order' | 'trace' }], supplies: [id]`.
- each trace: `{ seq, source, before: { values, model? }, steps }`. `before.model` is present when
  the structure differs from the previous event.
- steps, in the order they happened: `action`, `update {res, value, by}` (`by` is null inside the
  action), `activate {beh, via}`, `run {beh}`, `relink {beh}`, `effect {id, beh, name}` (queued),
  `effectRun {id, beh, name}`, `structure {model}`, `error {message}`.

Values are short display strings, not the values themselves.

## Files

| Path | What it is |
| --- | --- |
| `src/tracer.js` | `traceGraph(graph)`: the recorder |
| `src/text.js` | `explain`, `describeModel` |
| `src/mermaid.js` | `toMermaid` |
| `src/html.js` | `toHTML`: inlines the viewer and data into one file |
| `viewer/` | the replay page: graph layout (`graphview.js`), player (`player.js`), styles |
| `bin/bg-trace.js` | the CLI |
| `examples/` | `thermostat.mjs` (several inputs in one event, side effects), `rooms.mjs` (extents added and removed, dynamic demands) |
