# Behavior Graph: guide for coding agents

<!-- Maintainers: the skeleton (section 3) and collection (section 4) examples are copied
     in src/__tests__/agent-guide.test.ts, which runs them and fails if the copies differ.
     Change both together. -->

This guide is for an AI coding agent (or a person who likes dense references) writing
TypeScript or JavaScript with `behavior-graph`. It ships inside the npm package, so the copy
at `node_modules/behavior-graph/AGENT_GUIDE.md` matches the installed version. The
TypeScript source ships too, in `node_modules/behavior-graph/src/`. Where this guide and the
source disagree, the source wins.

Read sections 1 and 2 before writing code. Section 4 has patterns for the problems that come
up repeatedly, and section 5 lists every error you are likely to see, with the fix.

```ts
import { Graph, Extent, State, Moment, Resource, Behavior, GraphEvent,
         ExtentRemoveStrategy, RelinkingOrder } from "behavior-graph";
```

## 1. Mental model

Behavior Graph is a synchronous dataflow runtime. You do not write handlers that call
each other. You declare small units of logic (**behaviors**), each of which says which
values it reads (**demands**) and which values it writes (**supplies**). The runtime sorts
behaviors so that a writer always runs before its readers, and it runs only the behaviors
whose inputs changed.

**Resources** are the values. Two kinds matter:

- `State<T>` holds a value that persists across events (a count, a mode, a list). It
  remembers the event in which it last changed, so you can ask "did this change in the
  current event" (`justUpdated`) and "what was it before this event" (`traceValue`).
- `Moment<T>` records that something happened in the current event, optionally with a
  payload. It is true for exactly one event and then resets. User input, timer fires, and
  network replies are moments.

**Extents** are classes that group resources and behaviors with a shared lifetime. You
subclass `Extent`, declare resources as fields, build behaviors in the constructor, and add
the instance to the graph. An extent added to the graph participates; one removed from it
does not. Collections of things with their own lifecycle are collections of child extents.

**Graph** owns the event loop. There is usually one per application.

What happens when an input arrives:

1. Some outside code calls an **action** (`graph.action(() => {...})` or
   `resource.updateWithAction(v)`). This opens an **event** with a new sequence number.
   Inside the action block you update resources that no behavior supplies. Every update in
   one action block is simultaneous: all of them are `justUpdated` in the same event.
2. Behaviors that demand an updated resource are activated and run in dependency order
   (suppliers before demanders). Each behavior reads its demands, decides what to do, and
   updates the resources it supplies, which activates further behaviors. A behavior runs at
   most once per event.
3. Behaviors do not touch the outside world. They queue **side effects**
   (`ext.sideEffect(() => {...})`). After every activated behavior has run, side effects
   run in the order they were queued. Side effects see the final values for the event.
   Side effects are the only place you render, log, schedule timers, make network
   requests, or start another action.
4. Moments reset. The event ends. If a side effect started another action, that event now
   runs, synchronously, before control returns to the side effect.

Where state lives: in `State` resources on extents, each supplied by exactly one behavior
(or by nobody, in which case only actions may update it). Plain class fields on the extent
are fine for non-reactive bookkeeping (timer ids, request handles, references to views).

Where effects go: only into side effects. Never into behaviors, never into actions. The
runtime enforces most of this with exceptions; section 5 lists the exact messages.

### The design rule (read this first)

Behavior Graph is a decomposition tool. Its value is that every relationship between two
pieces of state is written down as its own small behavior, from the first version of the
program. That is what the runtime sorts, checks, and explains. Write it any other way and
you pay the ceremony with none of the return.

Concretely:

1. **One behavior per relationship.** Each behavior owns one piece of state (or one small
   cluster that always changes together) and encodes the rule for it. Ask "what decides
   this value?" and make that a behavior. A behavior more than about 60 lines, or one whose
   `runs` block has several unrelated `if` branches, is two or more behaviors.
2. **One supplier per resource, always.** When the runtime says a resource has two
   suppliers, the fix is to pick the owner and have the other behavior *demand* the resource
   (or supply a separate resource the owner demands). It is never to merge the two behaviors.
3. **One behavior per ordered output.** Side effects from unrelated behaviors run in an
   unspecified relative order. Where the order of outputs is observable (a log, a command
   stream, messages sent to a server), send all of them through one behavior that demands
   what they depend on and emits them in a fixed order from one side effect. Section 3 gives
   the shape.
4. **Create seams in the first version.** Between concerns (the thing that accepts inputs,
   the thing that owns state, the thing that talks to the network or timers) put a moment or
   state that the downstream side demands. Later features then attach to the seam instead
   of editing the owner. Section 4 names the recurring seams.
5. **Count behaviors.** A component with several concerns and three or fewer behaviors has
   collapsed into a reducer inside a wrapper. If you find yourself there, stop and split
   before adding the next feature; splitting later is the expensive part.

## 2. API surface

### Graph

```ts
class Graph {
  constructor();
  action(block: () => void, debugName?: string): void;     // open an event, run block, drain
  sideEffect(block: () => void, debugName?: string): void; // queue an effect (no extent arg)
  currentEvent: GraphEvent | null;   // non-null while an event is running
  lastEvent: GraphEvent;             // last completed event; starts at sequence 0
  currentBehavior: Behavior | null;  // non-null while a behavior block is running
  dateProvider: { now(): Date };     // stamps events; replace it to control time in tests
  validateLifetimes: boolean;        // default true; see lifetimes below
  validateTraceDemands: boolean;     // default false; set true: traceValue needs a demand or .trace
  debugHere(): string;               // text dump of current event/behavior
  subscribeToJustUpdated(resources: Resource[], callback: () => void): () => void;
}
class GraphEvent { sequence: number; timestamp: Date; }
```

`action` is synchronous: when it returns, the event, its side effects, and any events they
started have all completed. `actionAsync` exists; prefer `action` unless you have a reason.

### Extent

```ts
class Extent {
  constructor(graph: Graph);
  graph: Graph;
  debugName: string | undefined;
  addedToGraph: State<boolean>;          // false until added; justUpdated in the adding event
  addedToGraphWhen: number | null;       // event sequence of the add, null when not in graph

  state<T>(initialState: T, name?: string): State<T>;
  moment<T>(name?: string): Moment<T>;
  resource(name?: string): Resource;     // no value; used for ordering and as a link anchor
  behavior(): BehaviorBuilder<this>;

  action(block: (ext: this) => void, debugName?: string): void;
  sideEffect(block: (ext: this) => void, debugName?: string): void;

  addToGraph(): void;                    // only inside an event (action or behavior)
  addToGraphWithAction(debugName?: string): void;
  removeFromGraph(strategy?: ExtentRemoveStrategy): void;   // only inside an event
  removeFromGraphWithAction(strategy?: ExtentRemoveStrategy, debugName?: string): void;

  addChildLifetime(child: Extent): void; // call before adding the child to the graph
  unifyLifetime(other: Extent): void;    // both must then be added in the same event
  subscribeToJustUpdated(resources: Resource[], callback: (ext: this) => void): () => void;
}
enum ExtentRemoveStrategy { extentOnly, containedLifetimes }
```

Resources declared as class fields get their field name as `debugName` automatically when
the extent is added. The `runs`, `sideEffect`, and `action` callbacks receive the extent as
their argument, typed as the subclass, so `ext.count` is fully typed.

### BehaviorBuilder

```ts
this.behavior()
  .demands(...d: Demandable[])           // Resource, State, Moment, resource.order or state.trace
  .supplies(...s: Resource[])
  .dynamicDemands(switches: Demandable[],
                  links: (ext: this) => (Demandable | undefined)[] | null,
                  relinkingOrder?: RelinkingOrder)
  .dynamicSupplies(switches: Demandable[],
                   links: (ext: this) => (Resource | undefined)[] | null,
                   relinkingOrder?: RelinkingOrder)
  .runs(block: (ext: this) => void): Behavior;
enum RelinkingOrder { relinkingOrderPrior, relinkingOrderSubsequent }  // default Prior
```

Rules the builder implies:

- A behavior runs in an event only if at least one demanded resource updated in that
  event (including a demand just added by a relink). No demands means it never runs, and
  neither does a behavior whose every demand is `.trace` (the builder throws on that one).
- Calling `.demands(...)` or `.supplies(...)` again on the same builder adds to the list.
  `.dynamicDemands` and `.dynamicSupplies` may each be called once per behavior; a second
  call throws, so put every switch in one call and return all links from one function.
- Inside `runs`, you may read `.value`, `.event`, `.justUpdated` only on resources the
  behavior demands or supplies. You may call `.update()` only on resources it supplies.
- `resource.order` is an ordering-only demand: the behavior is sorted after that resource's
  supplier and may read it, but does not run when it updates. It is still an edge, so it
  forms cycles exactly as a plain demand does.
- `state.trace` is a trace demand: the behavior may read `state.traceValue` (the value from
  before this event) but not `.value`. It is not an edge: the behavior is not sorted after
  the state's supplier, does not run when the state updates, and can never form a cycle.
  With `graph.validateTraceDemands = true` (set it on every graph you create; the library
  default is off), `traceValue` and `traceEvent` inside `runs` may be read only on states
  the behavior supplies, demands (plain or `.order`), or declares with `.trace`.
- `dynamicDemands(switches, links)`: whenever any switch updates, `links(ext)` is re-run
  and its result becomes the behavior's extra demands for the rest of the event. With the
  default `relinkingOrderPrior` the relink happens before the behavior runs. Use
  `RelinkingOrder.relinkingOrderSubsequent` when the behavior itself supplies a switch
  (otherwise you get a cycle). `undefined` entries in the returned array are dropped.

### Resources

```ts
class Resource {
  debugName: string | null;
  extent: Extent; graph: Graph;
  suppliedBy: Behavior | null;       // introspection
  subsequents: Set<Behavior>;        // behaviors demanding this resource
  get order(): Demandable;
  get justUpdated(): boolean;        // always false on a plain Resource
}

class Moment<T = undefined> extends Resource {
  update(value?: T): void;                          // inside action or supplying behavior
  updateWithAction(value?: T, debugName?: string): void;  // wraps update in graph.action
  get justUpdated(): boolean;                       // true only during the event it fired
  get value(): T | undefined;                       // payload; undefined after the event
  get event(): GraphEvent | null;                   // when it last fired
  justUpdatedTo(value: T): boolean;                 // justUpdated && value == payload
}

class State<T> extends Resource {
  update(newValue: T): void;         // no-op if newValue === current value
  updateForce(newValue: T): void;    // update even if equal (forces justUpdated)
  updateWithAction(newValue: T, debugName?: string): void;
  get value(): T;
  get event(): GraphEvent;           // event of the last change; sequence 0 initially
  get justUpdated(): boolean;
  get trace(): Demandable;           // trace demand: permits traceValue, not an edge
  get traceValue(): T;               // value at the start of this event (needs a demand or .trace)
  get traceEvent(): GraphEvent;
  justUpdatedTo(to: T): boolean;
  justUpdatedFrom(from: T): boolean;
  justUpdatedToFrom(to: T, from: T): boolean;
}
```

`State.update` compares with `===`. Mutating an array in place and calling `update` with
the same reference does nothing; build a new array, or use `updateForce`.

`runs` returns the `Behavior` (fields `demands`, `supplies`, `order`; methods
`setDynamicDemands(...)`, `setDynamicSupplies(...)`, `toString()`). You rarely need it; the
builder's `dynamicDemands` covers the common cases.

### Lifetimes (why static demands across extents can fail)

With `validateLifetimes` on (the default), a behavior may statically demand or supply
another extent's resource only if that extent has the same lifetime (`unifyLifetime`) or is
an ancestor (`addChildLifetime`). Children may statically demand parent resources; a parent
reaches child resources only through `dynamicDemands`. Every demanded resource's extent
must already be in the graph when the demand is linked.

## 3. Connecting to the outside world

Behavior Graph owns the logic in the middle. Everything at the edges is ordinary code:

| Outside concern | Behavior Graph form |
| --- | --- |
| user input, socket message, any external event | one action per event; update input moments or states inside it (`moment.updateWithAction(payload)`) |
| timer | a side effect calls `setTimeout`; the callback does `moment.updateWithAction(...)` |
| network request, promise, callback API | a side effect starts it; the reply callback does `updateWithAction`, carrying a token so stale replies are ignored |
| rendering, logging, commands to other systems | inside a side effect only |
| reading state from UI code or tests | read `state.value` directly (allowed outside behaviors) |
| a UI framework that wants change notifications | `extent.subscribeToJustUpdated([...], cb)` or a behavior whose side effect pushes into the framework |
| teardown | cancel timers and requests, set a disposed flag, `removeFromGraphWithAction(ExtentRemoveStrategy.containedLifetimes)` |

**Ordering of outputs.** Side effects run after all behaviors, FIFO in the order queued.
Two unrelated behaviors (neither supplies something the other demands) run in an
unspecified relative order, and so do their side effects. So:

- When outputs must appear in a fixed order, emit them from **one output behavior**. It
  demands every resource the outputs depend on, checks `justUpdated` on each, and emits all
  outputs in one side effect in a fixed order. Every later output kind is one more branch in
  this behavior, and ordering across concerns is source order inside it.
- If a specific output must be computed by an upstream behavior (a command payload, say),
  that behavior supplies a moment carrying the payload and the output behavior demands it.
  Ordering still lives in the one output behavior.

Do not spread order-sensitive outputs across several behaviors and then try to fix the
order with `.order` demands. That is the most common source of ordering bugs.

**Actions from callbacks.** Timer, promise and network callbacks run outside any event, so
`updateWithAction` from them is correct. Starting an action inside a side effect is also
legal (rarely needed): the new event runs after the current event's remaining side effects,
before the call returns. An error thrown from an action inside a promise callback becomes
an unhandled rejection; make sure your environment reports those.

**Reading values in side effects.** `graph.currentBehavior` is null during side effects,
so reading any resource's `.value` there is allowed and sees the event's final values.
Capturing values in local consts inside the behavior is still clearer.

### Minimal skeleton (a press counter with an auto-reset timer and a greeting lookup)

```ts
import { Graph, Extent, ExtentRemoveStrategy } from "behavior-graph";

type View = { count: number; greeting: string | null; loading: boolean };

// The outside world, injected so tests can replace it.
interface Deps {
  fetchGreeting(count: number): Promise<string>;
  render(view: View): void;
}

class Counter extends Extent {
  // inputs: updated only from actions (UI events, timer callbacks, network callbacks)
  pressed = this.moment();
  resetFired = this.moment();
  greetingArrived = this.moment<{ token: number; text: string | null }>();
  // state: each supplied by exactly one behavior below
  count = this.state(0);
  activeRequest = this.state<number | null>(null);
  greeting = this.state<string | null>(null);
  // plain bookkeeping, not reactive
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextToken = 1;
  disposed = false;

  constructor(graph: Graph, private readonly deps: Deps) {
    super(graph);

    // one owner for count, reacting to two inputs with a fixed priority
    this.behavior()
      .demands(this.pressed, this.resetFired)
      .supplies(this.count)
      .runs((ext) => {
        if (ext.resetFired.justUpdated) ext.count.update(0);
        else if (ext.pressed.justUpdated) ext.count.update(ext.count.value + 1);
      });

    // timer tied to an input: restart on every press
    this.behavior()
      .demands(this.pressed)
      .runs((ext) => {
        ext.sideEffect(() => {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.timer = undefined;
            if (!this.disposed) ext.resetFired.updateWithAction();
          }, 1000);
        });
      });

    // async request per count, with a token so a stale reply is ignored
    this.behavior()
      .demands(this.count, this.greetingArrived)
      .supplies(this.activeRequest, this.greeting)
      .runs((ext) => {
        if (ext.count.justUpdated) {
          const token = this.nextToken++;
          const count = ext.count.value;
          ext.activeRequest.update(token);
          ext.sideEffect(() => {
            const arrived = (text: string | null) => {
              if (!this.disposed) ext.greetingArrived.updateWithAction({ token, text });
            };
            deps.fetchGreeting(count).then(arrived, () => arrived(null));
          });
        }
        const reply = ext.greetingArrived.value;
        if (ext.greetingArrived.justUpdated && reply !== undefined && reply.token === ext.activeRequest.value) {
          ext.activeRequest.update(null);
          ext.greeting.update(reply.text);
        }
      });

    // all rendering from one behavior; addedToGraph gives the first render
    this.behavior()
      .demands(this.addedToGraph, this.count, this.greeting, this.activeRequest)
      .runs((ext) => {
        const view = { count: ext.count.value, greeting: ext.greeting.value, loading: ext.activeRequest.value !== null };
        ext.sideEffect(() => deps.render(view));
      });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.removeFromGraphWithAction(ExtentRemoveStrategy.containedLifetimes);
  }
}

const graph = new Graph();
graph.validateTraceDemands = true; // traceValue reads must be declared (section 2)
const counter = new Counter(graph, {
  fetchGreeting: (n) => fetch(`/greeting?n=${n}`).then((r) => r.text()),
  render: (view) => { /* update the DOM, or hand the view to your UI framework */ },
});
counter.addToGraphWithAction();
button.addEventListener("click", () => counter.pressed.updateWithAction());
```

A test drives the same class with a fake `fetchGreeting`, calls
`counter.pressed.updateWithAction()`, and asserts on `counter.count.value` or on the views
passed to `render`. Use your test runner's fake timers for `setTimeout`. Everything inside the
graph is synchronous, so no waiting is needed except for the promise.

## 4. Patterns for the recurring problems

### Joint reaction: several inputs or derived changes in one event

This is the paradigm's strength. One behavior demands every resource that bears on a
decision and checks `justUpdated` on each in priority order. Because all updates in an
action are simultaneous, and derived resources upstream are already final when the
behavior runs, it sees the whole event at once.

```ts
this.behavior()
  .demands(this.cancelPressed, this.submitPressed, this.formValid, this.mode)
  .supplies(this.phase)
  .runs((ext) => {
    if (ext.cancelPressed.justUpdated) ext.phase.update("idle");            // highest priority
    else if (ext.submitPressed.justUpdated && ext.formValid.value) ext.phase.update("sending");
    else if (ext.mode.justUpdatedTo("locked") && ext.phase.value !== "idle") ext.phase.update("idle");
  });
```

To send several inputs as one event, put them in one action:
`graph.action(() => { ext.a.update(x); ext.b.update(y); })`. To react to a change and its
previous value, use `justUpdatedFrom`, `justUpdatedToFrom`, or compare `traceValue` with
`value`.

### Seams between concerns

A seam is a resource whose only job is to let one behavior hand a decision to another.
Three recur; create them in the first version, before you need them.

- **Accepted input.** The behavior that validates and accepts an input supplies a moment
  carrying only what downstream needs (`acceptedPlay`, `itemLoaded`), separate from the raw
  input moment. Later concerns (a countdown, a log, an analytics rule) demand the accepted
  moment instead of re-deriving acceptance from the raw input and the state.
- **Desired vs applied.** One behavior supplies the *desired* value from the inputs; a second
  demands desired and the current applied value, supplies applied, and emits a command moment
  when they diverge. Reconciliation rules then have a single home.
- **Transition moments.** `State.update` with an equal value is a no-op, so "restarted",
  "re-entered", or "seeked to the same position" is invisible to `justUpdatedTo`. Supply a
  moment alongside the state for such events and let downstream demand the moment.

### Pre-decider: a new concern that must run before an existing owner

When a new rule must influence a decision that an existing behavior already owns, do not
edit the owner's branches. Add an upstream behavior that supplies an *intent* resource
(`effectiveRequest`, `lockAllowsStart`) and have the owner demand it. If the upstream
behavior also needs the owner's state, declare it with `.trace` and read `traceValue` (the
value before this event). A `.trace` demand is not an edge, so it cannot form a cycle:

```ts
// upstream: decides what the owner should treat as the user's request
effectiveRequest = this.state<"start" | "hold" | "stop" | null>(null);

this.behavior()
  .demands(this.startRequested, this.lockEngaged, this.lockReleased, this.phase.trace, this.locked.trace)
  .supplies(this.effectiveRequest)
  .runs((ext) => {
    const wasRunning = ext.phase.traceValue === "running";   // previous event, via phase.trace
    if (ext.lockEngaged.justUpdated && wasRunning) ext.effectiveRequest.update("stop");
    else if (ext.startRequested.justUpdated && ext.locked.traceValue) ext.effectiveRequest.update("hold");
    else if (ext.startRequested.justUpdated) ext.effectiveRequest.update("start");
  });
// the owner of `phase` demands effectiveRequest, never startRequested directly
```

Ownership and run order are architecture: a behavior that must run *before* the owner of
state it needs will read `traceValue` forever, which is fine for a pre-decider and wrong for
anything that needs final values. Decide owners by who needs final values.

When a requirement says "every rule that reads X now reads Y", that means every output site
and every branch, not the rules you remember. With one behavior per relationship this is a
search for `.demands(` lines; inside one large behavior it is an audit you will get wrong.

### One piece of state written from several places

Give it exactly one supplying behavior, and make every "writer" an input (moment) that the
behavior demands. The behavior is the single place where conflicts are resolved.

```ts
this.behavior()
  .demands(this.incrementRequested, this.setRequested, this.resetRequested)
  .supplies(this.count)
  .runs((ext) => {
    if (ext.resetRequested.justUpdated) ext.count.update(0);
    else if (ext.setRequested.justUpdated) ext.count.update(ext.setRequested.value!);
    else if (ext.incrementRequested.justUpdated) ext.count.update(ext.count.value + 1);
  });
```

Each part of the system that wants to write the state gets its own moment; this behavior
arbitrates. Two behaviors supplying one resource is rejected when the extent is added. When
that happens, keep the two behaviors and move ownership, never merge them: the behavior that
lost ownership supplies its own moment (its request) and the owner demands it.

### Ordering

- Between behaviors: ordering follows data. If B must see A's result, B demands what A
  supplies; if B must merely run after A, B demands `aResource.order`. When there is no data
  to share, A can supply a bare `this.resource()` purely so B can demand its `.order`.
- Between side effects in one event: queued order equals behavior run order. Where output
  order matters and the behaviors are unrelated, use one output behavior (section 3) or add
  a data dependency.
- Within one behavior: several `ext.sideEffect` calls run in source order.

### Stale async responses

Keep a token in a `State` supplied by the behavior that starts the request. The callback
carries the token back in the moment payload; the behavior acts only on a matching token.
Cancel superseded requests too (an `AbortController`, a handle's `cancel()`), but still check
the token: a cancelled request can still call back.

```ts
searchRequested = this.moment<string>();
searchReply = this.moment<{ token: number; results: string[] }>();
searchToken = this.state<number | null>(null);
results = this.state<string[]>([]);

this.behavior()
  .demands(this.searchRequested, this.searchReply)
  .supplies(this.searchToken, this.results)
  .runs((ext) => {
    if (ext.searchRequested.justUpdated) {
      const token = ++this.tokenCounter;
      const query = ext.searchRequested.value!;
      ext.searchToken.update(token);
      ext.sideEffect(() => {
        this.searchAbort?.abort();
        this.searchAbort = new AbortController();
        this.api.search(query, this.searchAbort.signal).then(
          (r) => { if (!this.disposed) ext.searchReply.updateWithAction({ token, results: r }); },
          () => { if (!this.disposed) ext.searchReply.updateWithAction({ token, results: [] }); },
        );
      });
    }
    const reply = ext.searchReply.value;
    if (ext.searchReply.justUpdated && reply && reply.token === ext.searchToken.value) {
      ext.searchToken.update(null);
      ext.results.update(reply.results);
    }
  });
```

### Collections whose membership changes

Model each member as a child extent. The parent owns a `State<Child[]>` supplied by one
behavior that adds and removes children inside the graph. Aggregations over the children
use `dynamicDemands` switched on the list.

```ts
class Item extends Extent {
  done = this.state(false);
  toggle = this.moment();
  constructor(graph: Graph, readonly id: string) {
    super(graph);
    this.behavior().demands(this.toggle).supplies(this.done)
      .runs((ext) => { ext.done.update(!ext.done.value); });
  }
}

class List extends Extent {
  addRequested = this.moment<string>();
  removeRequested = this.moment<string>();
  items = this.state<Item[]>([]);
  doneCount = this.state(0);

  constructor(graph: Graph) {
    super(graph);

    // membership: create children inside the behavior, in the same event
    this.behavior()
      .demands(this.addRequested, this.removeRequested)
      .supplies(this.items)
      .runs((ext) => {
        if (ext.addRequested.justUpdated) {
          const item = new Item(ext.graph, ext.addRequested.value!);
          ext.addChildLifetime(item);
          item.addToGraph();
          ext.items.update([...ext.items.value, item]);
        }
        if (ext.removeRequested.justUpdated) {
          const id = ext.removeRequested.value;
          const gone = ext.items.value.filter((i) => i.id === id);
          gone.forEach((i) => i.removeFromGraph());
          ext.items.update(ext.items.value.filter((i) => i.id !== id));
        }
      });

    // aggregate: demands change whenever the list changes
    this.behavior()
      .demands(this.items)
      .dynamicDemands([this.items], (ext) => ext.items.value.map((i) => i.done))
      .supplies(this.doneCount)
      .runs((ext) => {
        ext.doneCount.update(ext.items.value.filter((i) => i.done.value).length);
      });
  }
}
```

Points that matter:

- `addChildLifetime(child)` before `child.addToGraph()`. This lets the child's behaviors
  statically demand parent resources and lets `removeFromGraphWithAction(
  ExtentRemoveStrategy.containedLifetimes)` on the parent remove all children at once.
- Add the child and update the list in the same behavior. The relink runs after it and
  before the aggregate (default `relinkingOrderPrior`), so the aggregate sees the new
  demands in the same event.
- A child's behaviors run in the event it is added if one of their demands is
  `justUpdated` in that event (for example `addedToGraph`, or a parent moment).
- Remove the child from the graph and from the list in the same event. At event end the
  graph checks that no remaining behavior still demands a removed resource; the relink
  satisfies this as long as the list changed in that event.
- Routing an input to a child: find it in `items.value` and call `item.toggle.update()`
  inside the action; actions may update any unsupplied resource on any extent.
- If the aggregate itself must supply the switch (it changes the list), pass
  `RelinkingOrder.relinkingOrderSubsequent` as the third argument to `dynamicDemands`.

### Timers tied to conditions

Decide in a behavior, schedule in a side effect, report the fire as a moment. Arm and
disarm on transitions, not on every event.

```ts
armed = this.state(false);       // derived by some behavior
timeout = this.moment();

this.behavior()
  .demands(this.armed)
  .runs((ext) => {
    if (ext.armed.justUpdatedTo(true)) {
      ext.sideEffect(() => {
        this.timerId = setTimeout(() => {
          this.timerId = undefined;
          if (!this.disposed) ext.timeout.updateWithAction();
        }, 5000);
      });
    } else if (ext.armed.justUpdatedTo(false)) {
      ext.sideEffect(() => { clearTimeout(this.timerId); this.timerId = undefined; });
    }
  });
```

For a repeating tick, a behavior demanding `tick` re-arms in a side effect while the
condition holds. Always clear timers in teardown.

When several rules can arm, disarm, or leave a timer alone in one event, let the deciding
behavior supply a tri-state: `armFor: State<number | null | undefined>` where a number arms
for that many ms, `null` disarms, and `undefined` means leave the running timer alone. The
timer behavior demands only `armFor` and does the scheduling. That keeps timer ownership in
one place while several behaviors influence it.

Extent helper methods called from inside `runs` may read demanded resources and call
`ext.sideEffect`; the runtime tracks the current behavior, not the call stack.

### Cycles

A cycle is behavior A demanding something B supplies while B demands something A supplies.
The graph throws when the extent is added or relinked. Fixes, in order of preference:

1. Decide which behavior is upstream and break the back-edge with a `.trace` demand, which
   is not an edge: the upstream behavior replaces the downstream state in its demands with
   `state.trace` and reads `traceValue`, the previous-event value (the pre-decider pattern
   above).
2. Introduce a seam: the upstream behavior supplies a moment carrying only what downstream
   needs, and downstream demands that instead of the upstream state. Changing a plain
   demand to `.order` does not break a cycle: `.order` is still an edge.
3. Only if A and B are genuinely one decision (the same inputs, the same rule, always
   changing together): merge them into one behavior. This should be rare. A merge to make an
   error go away is how graphs collapse into one giant behavior.

Do not "fix" a cycle with a side effect that starts a new action; that makes two events
per input and reorders outputs.

### A new upstream cause: the cycle that feature changes create

Most cycles do not appear in a first version. They appear when a new feature gives an
existing state a new cause. Some state that many behaviors check (a request token or
sequence number, the current item, a phase, an intent) has one owner. The change makes a
behavior that sat *downstream* of that state (a countdown, a retry rule, an auto-advance, a
reply handler) also feed the owner, by supplying a new request, reload or advance moment.
Now every demand that this behavior, or any behavior upstream of it, already had on the
state, or on anything computed from it, is a back-edge. Those demands were legal before the
change, and the change did not touch them. `.order` demands count too, because `.order` is
an edge.

Two habits prevent it:

1. **Acceptance checks read pre-event state through `.trace`, from the first version.** A
   behavior that accepts, filters or routes an input by comparing it with current state
   ("is this reply for the current token?", "is this callback from the current item?", "was
   the user playing when this arrived?") wants the state as it stood when the input
   arrived. One input is one event, so that is the value before this event: declare the
   state with `.trace` and read `traceValue`. The check then has no edge to the state's
   owner, and no later cause of that state can close a loop through it. Use a plain demand
   and `.value` only when the rule must see a change made earlier in the *same* event (for
   example, the item that this event's own advance just loaded). A rule like that runs
   after the change by definition, so it must not feed the change.
2. **Before a behavior supplies a new resource, walk downstream from it.** Write down the
   new resource's consumers, what they supply, and so on, until you reach the states that
   the accepting and deciding behaviors check. If the behavior getting the new supply, or
   one upstream of it, demands any of those (plain or `.order`), change that demand to
   `.trace` if the pre-event value is what the rule means. Otherwise put the new supply in
   its own small behavior that demands only what the new rule needs. A behavior that
   supplies two resources makes both depend on all of its demands, so a demand added for
   one of them can close a loop through the other.

If the graph still reports a cycle after such a change, assume the same new cause reached
more than one old demand. Walk downstream again and fix every back-edge it created before
rerunning, not just the edge the message lists first.

### Teardown

After teardown there should be no more output, timers, or requests. Do these in order: set
a `disposed` flag that every timer and network callback checks; clear every timer you hold;
cancel every pending request; then
`root.removeFromGraphWithAction(ExtentRemoveStrategy.containedLifetimes)`. Once an extent is
removed its behaviors stop running and updates to its resources are ignored, so a late
callback does nothing inside the graph. The flag and the cancellations keep a late callback
from doing anything *outside* it, and keep timers from holding the extent in memory.

### Testing

Everything inside the graph runs synchronously within the action that started it, so a test
is: build the graph and extents with fakes for the outside world, call actions, and assert on
`state.value` or on what the fakes received. Set `graph.dateProvider` if behaviors read
`graph.currentEvent.timestamp`. Group inputs that happen together into one `graph.action` so
the test sends them as one event, exactly as production code would.

## 5. Pitfalls

Each entry gives the error text you will see (if any), the wrong form, and the right form.
The error messages are written to be read: they name the resources and behaviors involved
and usually say what to change.

**Naming a field after an Extent member.**
`state`, `moment`, `resource`, `behavior`, `action`, `sideEffect`, `graph`, `resources`,
`behaviors` and `addedToGraph` already exist on every extent. A field with one of those names
hides it. tsc then reports errors that do not mention the clash, such as `TS7022: 'state'
implicitly has type 'any' because ... it is referenced directly or indirectly in its own
initializer`, `TS2729: Property 'state' is used before its initialization` or `TS2347:
Untyped function calls may not accept type arguments`. At runtime the next field's
`this.state(...)` throws `TypeError: this.state is not a function`, and if construction gets
that far, `addToGraph` throws `<Extent> has a field named "state", which hides Extent's own
method "state"`. Wrong: `state = this.state<Phase>("idle")`. Right: `phase =
this.state<Phase>("idle")` (or `status`, `lifecycle`).

**A behavior whose demands are all `.trace`.**
`Error: The behavior in <Extent> that supplies [...] and demands [a.trace, b.trace] can never
run: every one of its demands is a .trace link.` (thrown by `.runs`). A `.trace` demand is
not an edge, so nothing ever makes the behavior run, and a value it supplies would never
change. Wrong: a derived snapshot `.demands(this.served.trace,
this.count.trace).supplies(this.snapshot)`. Right: demand without `.trace` whatever should
recompute it (the states it is computed from, or the moment that triggers it), and keep
`.trace` only for values from before the event that must not trigger the rule.

**Two behaviors supply one resource.**
`Error: Resource "count" is supplied by two behaviors: behavior (also supplies: ...) and
behavior (...). A resource must have exactly one supplying behavior ... Do not merge the
two behaviors into one` (thrown when the extent is added; `err.alreadySupplied`,
`err.desiredSupplier`). Wrong: two behaviors each with `.supplies(this.count)`. Right: keep
both behaviors; one owns `count`, the other supplies its own request moment that the owner
demands (section 4, "One piece of state written from several places"). Do not merge.

**Reading a resource you did not demand.**
`Error: Cannot access the value or event of a resource inside a behavior unless it is
supplied or demanded.` Wrong: `.demands(this.a).runs(ext => ext.b.value)`. Right: add
`this.b` (or `this.b.order` if you only need to read it) to `demands`, or add `this.b.trace`
and read `ext.b.traceValue` if the previous value is what you want.

**Reading a previous value you did not declare.**
`Error: Cannot read "b.traceValue" here: the behavior in ... neither demands nor supplies b
and does not declare b.trace ...` (only with `graph.validateTraceDemands = true`). Wrong:
`.demands(this.a).runs(ext => ext.b.traceValue)`. Right: `.demands(this.a, this.b.trace)`, or
demand `this.b` and read `.value` if the rule needs this event's value.

**Updating a resource from a side effect or callback without an action.**
`Error: Resource must be updated inside a behavior or action.` Wrong: in a timer callback,
`ext.tick.update()`. Right: `ext.tick.updateWithAction()`.

**Starting an action inside a behavior or action.**
`Error: Action cannot be created directly inside another action or behavior. Consider
wrapping it in a side effect block.` Wrong: `runs(ext => ext.other.updateWithAction(1))`.
Right: supply `other` and call `ext.other.update(1)`, or queue a side effect if a second
event is really intended.

**Updating a supplied resource from an action, or an unsupplied one from a behavior.**
`Error: Supplied resource can only be updated by its supplying behavior.` and
`Error: Unsupplied resource can only be updated in an action.` Decide for each resource:
input (unsupplied, actions write it) or derived (one behavior supplies it). Never both.

**Forgetting that moments last one event.**
No error. Wrong: a behavior demanding `this.clicked` and something else reads
`ext.clicked.value` on the later event and finds `undefined`. Right: copy the payload into
a `State` in the event it arrives if it must survive.

**Async work in a behavior.**
No error until the callback runs (then one of the above). Wrong: calling `fetch` or
`setTimeout` directly in `runs`. Right: wrap in `ext.sideEffect(() => {...})` and have
callbacks use `updateWithAction`.

**Output outside a side effect.** No graph error, but the output happens before other
behaviors have run, so it can see stale values and ordering breaks. Always render, log and
send from a side effect.

**Cycles by demanding what you supply.**
`Error: Behavior dependency cycle detected: 3 behaviors each demand a resource supplied by
the next, so none can run first.` The message then lists each behavior on the loop, the
resource it demands from the next, and the fixes (`err.cycle` holds the resources). A single
behavior may both demand and supply the same resource (`count.update(count.value + 1)`)
without a cycle; the error is about two or more behaviors. See section 4, Cycles, and "A new
upstream cause", the usual source.

**Forgetting `addToGraphWithAction`.** Nothing runs, and any behavior demanding one of the
extent's resources throws `Error: All demands must be added to the graph.` Also
`Error: addToGraph must be called within an event.` if you call `addToGraph()` outside an
action; use `addToGraphWithAction()` at setup, plain `addToGraph()` inside behaviors.

**Static demand across extents without a lifetime relation.**
`Error: Static demands can only be with extents with the unified or parent lifetimes.`
(or the same with `supplies`). Right: parent calls `addChildLifetime(child)` before adding
it, and the parent reaches child resources only through `dynamicDemands`.

**Removing a child but leaving a demand on it.**
`Error: Remaining behaviors must remove dynamicDemands to removed resources.` Right: update
the list that switches the dynamic demands in the same event as `removeFromGraph()`.

**Expecting a new behavior to run on add.** Behaviors run only when a demand updates. If
something must happen when the extent enters the graph, demand `this.addedToGraph` and
check `ext.addedToGraph.justUpdated`.

**`State.update` with an equal value does nothing.** Repeating the same value produces no
`justUpdated`, so no downstream behavior and no output. Use a `Moment` for "this happened
again" semantics, or `updateForce`. Arrays and objects compare by reference; create new
ones.

**Side effects from the wrong place.** `Error: Nested side effects don't make sense` when
`sideEffect` is called inside a side effect; `Error: Effects can only be added during an
event.` when it is called from plain code. Only behaviors and actions may queue them.

**`exactOptionalPropertyTypes` and moment payloads.** Declare payload fields as
`x: T | undefined` rather than `x?: T`, or assignments from optional inputs will not compile.

**Object or array `State` without a content compare.** `State.update` compares by
reference, so a derived `State<T[]>` rebuilt every event is `justUpdated` every event and any
"emit only when changed" rule breaks. Compare contents before `update`, or better, split the
array into per-member child extents or per-field states so equality is by value.

**One giant behavior.** No error. The runtime cannot check a rule that lives in one branch of
a 300-line `runs` block and is missing from another. If a defect is "this branch forgot to
read X", the fix is to make "reads X" a behavior that every consumer demands.

When any of these throws, the graph discards pending actions, effects and activated
behaviors and rethrows out of `graph.action`, so the exception surfaces from the code that
started the action. State updated earlier in the event is kept. Fix these; do not catch them.

## 6. Debugging

What the graph exposes at runtime:

- `graph.currentEvent?.sequence`, `graph.lastEvent.sequence`: event numbers. The first
  action is sequence 1 (`addToGraphWithAction` is often event 1).
- `graph.currentEvent.timestamp`: from `graph.dateProvider`.
- `state.event.sequence` / `moment.event?.sequence`: when a resource last changed.
- `resource.debugName`: the field name after the extent is added, or the name you passed.
  `resource.toString()` gives `name(s)=value : seq` for states, `name(m)=payload : seq` for
  moments.
- `resource.suppliedBy`, `resource.subsequents`: who writes and who reads it.
- `behavior.order` and `behavior.toString()`: topological rank and the supply/demand lists.
  `extent.behaviors` lists an extent's behaviors.
- `graph.debugHere()`: during an event, the sequence, the resources updated by the action,
  and the current behavior. Call it from inside a `runs` block when something looks wrong.
- `extent.addedToGraphWhen`: null when the extent is not in the graph.

To see event by event what changed, add a tracing behavior in the root extent that demands
everything of interest and logs from a side effect. It supplies nothing, so it does not
perturb ordering.

```ts
this.behavior()
  .demands(this.pressed, this.count, this.greeting, this.activeRequest)
  .runs((ext) => {
    const seq = ext.graph.currentEvent!.sequence;
    const changed = [ext.pressed, ext.count, ext.greeting, ext.activeRequest]
      .filter((r) => r.justUpdated)
      .map((r) => r.toString());
    ext.sideEffect(() => console.log(`event ${seq}:`, changed.join(", ")));
  });
```

Alternatives when you do not want to edit the extent:

- `graph.subscribeToJustUpdated([res1, res2], () => console.log(res1.toString()))` runs the
  callback as a side effect at the end of any event in which one of the resources updated.
  Reading values inside it is allowed. Returns an unsubscribe function.
- Log `graph.lastEvent.sequence` before and after an action: a jump of more than one means a
  side effect started an extra action.

Reading a failure: for the failing input, confirm the related updates happened in one
action, then log `graph.currentEvent.sequence` at the top of each suspect `runs`. A
behavior that did not run has a demand that did not update: either `State.update` got an
equal value or the resource is missing from `demands`. Misordered output means two
unrelated behaviors each queued a side effect; collapse them into one.
