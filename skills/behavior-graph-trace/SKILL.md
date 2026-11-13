---
name: behavior-graph-trace
description: Record what a behavior-graph program did, event by event, and read it as text. Use to debug a graph (a behavior that did or did not run, a wrong value, effects in the wrong order), to check that a change produces the events you expect, or to answer how a graph works; it can also draw the graph or write a step-through replay for a person.
---

# Tracing a Behavior Graph

`bg-trace` records each event a graph runs: what started it, each value updated, each behavior
that ran in order *with the demands that had changed before it ran*, each side effect, and
extents added or removed. It prints this as text. Read the trace instead of guessing from the
code: the code says what a graph could do, the trace says what it did.

The tool lives in the bgjs repository at `tools/trace`; it is not in the npm package. In a bgjs
checkout it is already there. Elsewhere, clone `https://github.com/yahoo/bgjs` next to the
project. Run `npm install` once in `tools/trace`. The tool imports nothing from the library; a
scenario uses whatever `behavior-graph` its own folder resolves.

## Steps

1. **Write a scenario** that reproduces the question exactly: the same extents, the same inputs,
   grouped into the same actions as the real code. Put it in the project (or a scratch folder
   inside it) so `import ... from 'behavior-graph'` and the project's own modules resolve. Node
   runs `.mts`/`.ts` scenarios directly when they use only erasable TypeScript syntax; otherwise
   import the project's built JS.

   ```js
   import * as bg from 'behavior-graph';
   import { Player } from '../src/player.js';

   export default function scenario({ trace }) {
     const graph = new bg.Graph();
     const tracer = trace(graph);                    // before any extent is added
     const p = new Player(graph);
     tracer.nameBehaviors(p, ['Choose source', 'Decide playback', 'Render']);   // declaration order, optional
     p.addToGraphWithAction('start');
     graph.action(() => { p.play.update(); p.seek.update(30); }, 'play and seek together');
     p.loaded.updateWithAction(true, 'load finishes');
   }
   ```

   Label every action (the last argument to `action`/`updateWithAction`, or
   `tracer.withSource('label', () => ...)`) so each event in the output says what it was.
   Replace the outside world (network, timers) with fakes and deliver their results as actions,
   as a test would.

2. **Run it**: `node <bgjs>/tools/trace/bin/bg-trace.js scenario.mjs --model`. `--model` adds
   each behavior with its demands and supplies.

3. **Read the events.** For each event:
   - `action:` lines are the updates made inside the action.
   - Numbered lines are the behaviors that ran, in run order. `(because a and b changed)` names
     the demands that had updated earlier in the event. A behavior missing from an event did
     not run: none of its demands updated (or an update set an equal value).
   - `updates x = v` and `queues a side effect "name"` are what each behavior did.
   - `then side effects ran:` lists effects in the order they ran, after every behavior.
   - `graph changed:` lines report extents added or removed and dynamic demands relinked.
   - If the scenario threw, the failing event ends with `ERROR:` and the library's message.

   Done when you can point at the event and line that answers the question, and the answer
   cites it ("in event 3, *Decide playback* ran because `play` and `seek` changed, and updated
   `state = playing` before *Render* queued its effect").

## Checking output

To verify a change, write the scenario first, write down the run order, values and effects you
expect for each event, then run it and compare line by line. Things the trace shows directly:

- two inputs in one action produce one pass, with one behavior run `because` both changed;
- a new behavior runs before or after an existing one;
- an input causes exactly the effects intended, in order, and nothing else;
- adding or removing an extent relinks what it should.

Inside a test, import the recorder and print the explanation when an assertion fails:

```js
import { traceGraph, explain } from '<bgjs>/tools/trace/src/index.js';

const tracer = traceGraph(graph);
// ...actions...
const data = tracer.toJSON();    // { model, traces }: steps per event, for asserting run order
console.log(explain(data));      // or explain(data, { events: [3] })
```

## Showing a person

- `--mermaid` prints a Mermaid diagram (behaviors that ran in the last event are numbered); it
  renders in GitHub and most Markdown viewers.
- `--html replay.html` writes one self-contained page that steps forwards and backwards through
  each event on a drawing of the graph. Give the person the file path.
- `--json trace.json` saves the trace; `bg-trace --viewer viewer.html` writes a page that opens
  a dropped trace file.

The format and API are in `tools/trace/README.md`.
