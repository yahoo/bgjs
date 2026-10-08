
# Behavior Graph

Behavior Graph lets you build your programs out of small, easily understood pieces in a way that lets the computer do more of the work for you.

It is an architecture and supporting library that simplifies the type of complexity that comes with event-driven software, such as user facing applications and control systems.

It's also a fun way to program.

> **Coding agents:** read [AGENT_GUIDE.md](AGENT_GUIDE.md) before writing code with this library. It ships in the package, so the copy at `node_modules/behavior-graph/AGENT_GUIDE.md` matches the installed version. The [For coding agents](#for-coding-agents) section at the end of this README says what the library gives you and why.

## A quick look

```typescript
import { Graph, Extent } from "behavior-graph";

class Counter extends Extent {
  increment = this.moment();   // something happened (an input)
  reset = this.moment();
  count = this.state(0);       // a value that persists

  constructor(graph: Graph) {
    super(graph);

    // the rule for count: what it reads, what it writes, and how
    this.behavior()
      .demands(this.increment, this.reset)
      .supplies(this.count)
      .runs((ext) => {
        if (ext.reset.justUpdated) ext.count.update(0);
        else if (ext.increment.justUpdated) ext.count.update(ext.count.value + 1);
      });

    // the display: runs whenever count changes, after count's rule has run
    this.behavior()
      .demands(this.count)
      .runs((ext) => {
        const text = String(ext.count.value);
        ext.sideEffect(() => { document.querySelector("#count")!.textContent = text; });
      });
  }
}

const graph = new Graph();
const counter = new Counter(graph);
counter.addToGraphWithAction();
button.addEventListener("click", () => counter.increment.updateWithAction());
```

Nothing calls the display code. It declares that it depends on `count`, and Behavior Graph runs it whenever `count` changes, in the right order, once per event.

## Who's it for?

It is particularly helpful for developers building:

* Web app front ends
* Mobile and desktop applications
* Control systems
* Robots

We originally developed it for ourselves to use in a video playing library at Yahoo. Even though we had experienced engineers and excellent test coverage, we still struggled with the complexity of the codebase. Behavior Graph is our solution.

It's also possible you're the type of person who likes nerdy new software ideas. (Seriously though, who doesn't, amirite?) If that's the case, we guarantee you will find Behavior Graph interesting.

## Can I see an example?

Behavior Graph introduces a handful of new concepts.
These concepts aren't difficult, but you will require some orientation.

* We've created a [short walk-through of a Login form](https://yahoo.github.io/bgdocs/docs/js-and-typescript/code-example/) using Behavior Graph.
* You can also take a look at [one of our tutorials](https://yahoo.github.io/bgdocs/docs/js-and-typescript/tutorial-1/).

## How does it Work?

As programmers it's natural to partition our software into subtasks. For example, let's consider what happens on a typical login form.

1. When a user clicks on the Login button, we want to validate the Email and Password fields.
2. If validation passes, then we want to make a network call to log the user in.
3. Additionally we want to update the UI to provide feedback in case the validation fails, or disable the login button while we are actively logging in.
  
Most programming languages offer __functions__ as the primary tool for creating these subtasks. Conceptually we have three subtasks. So we will create three corresponding functions: `validateFields`, `networkLogin`, and `updateUI`. We will also need an additional `onLoginClick` function to run these tasks. It will look like this:

```javascript
function onLoginClick() {
  validateFields();
  networkLogin();
  updateUI();
}
```

Our four functions are not independent, however. There are __dependency relationships__ between them that need to be respected.
* `validateFields` depends on `onLoginClick` being run. 
* `networkLogin` depends on `onLoginClick` being run, and it depends on the results of `validateFields`. 
* `updateUI` depends on the results of both `validateFields` and `networkLogin`.

But looking at the code, there is nothing that says, `networkLogin` depends on `validateFields`. Instead, we implement this relationship by calling our functions in a specific order. If we were to call `networkLogin()` before `validateFields()`, the feature wouldn't work.

So as long as we are organizing our code using only functions, we will need to implement part of our logic in terms of ordered function calls. This is because function definitions cannot express dependency relationships directly. There is no other way.

We could do more by using parameters and return values (aka functional programming), but that still wouldn't remove the need to call these functions in a valid order. Calling something like `networkLogin(validateFields())` is still a sequence of function calls.

It is the job of the developer to translate these dependency relationships into sequenced function calls. This requires time and effort:
* There's work to get it correct, which is often much more difficult than in our example here.
* Features inevitably change, which means dependencies inevitably change. So there's work in updating our existing sequences.
* When reading code, we must mentally translate back from function calls to the original dependency relationships. This is so we can understand the intent of the code. This is also work.
* And finally there's work fixing errors whenever any of these efforts go wrong.

We're proposing that maybe all this work isn't necessary. What if function definitions _could_ express dependency relationships?

__Behavior Graph__ is a library that provides this alternative. It introduces a new unit of code organization called the __behavior__. It is a block of code together with its dependency relationships.

Unlike functions, behaviors are never called directly. Instead, behaviors declare their interfaces using reactive containers of data called __resources__. When data in these resources changes, Behavior Graph knows that any dependent behaviors need to run. Behaviors together with resources form a graph. (A graph of behaviors! Get it?!)

This gives us:
1. _Control flow for free_: The computer uses the dependency relationships to run our behaviors in the correct sequence. This works just like spreadsheet formulas.
2. _Ease of maintenance_: Requirements inevitably change. This means dependencies change. Control flow automatically adapts.
3. _Legibility_: Dependency relationships are explicit. We can look at a behavior and immediately see how it interfaces with other behaviors. This is unlike function definitions which are linked via calls in some other part of the program.

Behavior Graph isn't a replacement for functions. (We wrote it with functions, hello!) Instead it gives us higher level abstractions for partitioning our code into subtasks. It lets us say "these two blocks of code are related and here's how". And with that information the computer is able to run things for us. And humans are better able to infer the intent of the code.

## Small

Behavior Graph is a small library. It's around 2000 lines of formatted code. It has no dependencies.

## Incremental 

It is easy to introduce into a codebase incrementally. It is designed to work side by side with existing code. We went through this incremental migration process ourselves.

## Scale

A complex codebase is exactly where it brings the most benefit. Our team uses it daily in a codebase where the status quo wasn't good enough.

## Multiplatform

Behavior Graph has been ported to multiple platforms.

* Javascript/Typescript: [bgjs](https://github.com/yahoo/bgjs)
* Objective-C: [bgobjc](https://github.com/yahoo/bgobjc)
* Swift: [BGSwift](https://github.com/yahoo/BGSwift)
* Kotlin/Android: [bgkotlin](https://github.com/yahoo/bgkotlin)

## Should I Use it in my Project?

This Javascript/Typescript version is not used in production at Yahoo currently. It is a direct port from the original Objective-C. It has excellent test coverage. We are confident it works as intended.

You won't find many blog posts and Stack Overflow answers to your questions. If you are on a team that expects that type of support you should proceed with caution.

If you are building a browser based app using imperative UI libraries such as JQuery or direct DOM manipulation we think you should be fine. For React there is a small adapter, [react-behavior-graph](https://www.npmjs.com/package/react-behavior-graph) (see `examples/todomvc-react`). With other reactive UI frameworks such as Angular or Ember you will need to figure out how to make that work. We do not have adapters for them.

Would like to help us with any of these adapters? We would certainly love to have your help. Please reach out to us on [discord](https://discord.gg/5mvat8tc7d).

## Obtaining Behavior Graph

Javascript Behavior Graph is hosted on NPM @ [behavior-graph](https://www.npmjs.com/package/behavior-graph).

```bash
npm install behavior-graph
```

To use it directly in a browser without a build step, load it from a CDN that serves npm packages, such as [jsDelivr](https://www.jsdelivr.com/package/npm/behavior-graph). As an ES module:

```html
<script type="module">
  import { Graph, Extent } from "https://cdn.jsdelivr.net/npm/behavior-graph@2/+esm";
</script>
```

Or as a classic script, which defines a global `bg`:

```html
<script src="https://cdn.jsdelivr.net/npm/behavior-graph@2/lib/behavior-graph.js"></script>
<script>
  const { Graph, Extent } = bg;
</script>
```

## Documentation

[Go here for the full documentation site](https://yahoo.github.io/bgdocs/docs/).

While there are only a handful of basic concepts in Behavior Graph, it does require a shift in thinking. We recommend you start with the [Getting Started guide](https://yahoo.github.io/bgdocs/docs/js-and-typescript/quickstart/) then work through the [Tutorials](https://yahoo.github.io/bgdocs/docs/js-and-typescript/tutorial-1/).

[AGENT_GUIDE.md](AGENT_GUIDE.md) is a dense single-page reference: the whole API, design rules, patterns, and every error message with its fix. It is written for coding agents, and is useful to people who prefer a reference to a tutorial.

## Contact Us

We really do need help and we really do like talking about Behavior Graph.
Discord is a good place for that.

[Behavior Graph Discord](https://discord.gg/5mvat8tc7d)

## Contributing

* Yes, there are many interesting areas for contribution. Please ask us.
* Don't just make a pull request. Talk to us first. We don't want to see you put in effort on something that won't get accepted.

## Comparisons

Behavior Graph builds on concepts from [reactive programming](https://en.wikipedia.org/wiki/Reactive_programming). It uses the same underlying idea to automate control flow by using existing dataflow dependencies.

However, programming with Behavior Graph feels different than when using other reactive programming libraries. It is not functional reactive programming. It is not built around streams. And it is not optimized for assembling observable chains of data transformations.

Behavior Graph is also not a reactive UI library. You should continue to use your preferred UI framework of choice.

Instead Behavior Graph gives developers a tool for organizing their software around dependency relationships. We consider the following features essential for this:

* __Bipartite Graph__: Behavior Graph separates reactive blocks of code, _behaviors_, from reactive containers of data, _resources_. Behaviors can update multiple resources independently. Their relationships can vary dynamically at runtime. They can exist in separate modules and with separate lifetimes.
* __Imperative Friendly__: Many reactive libraries have a strong functional programming flavor. This can lead to added friction when working with non-reactive code. Behavior Graph is designed to be compatible with existing imperative code and APIs. The code inside behaviors is as imperative as you like. We provide ways to create side effects and mutate state. You are free to read the contents of resources from external code.
* __Explicit__: Behaviors declare their relationships explicitly. This aids in navigation and readability in large codebases. Reading and writing reactive data does not look like normal variable access. Reactive variables are not the same as normal variables and we prefer presenting them that way.
* __Error Detection__: By understanding the underlying graph, the computer is able to detect errors for us. Behavior Graph tells us when we have specified our dependencies incorrectly.
* __Glitch Free__: Glitches occur when multiple dependency paths result in the same reactive code getting run twice. Behavior Graph does not have glitches.
* __Transactional__: Side effects are always postponed until after all other reactive code has completed to ensure consistent state. Reactive events are serialized to prevent side effects from leaking new reactive events into the current event.
* __A Language for Change__: We can ask a resource if it "just updated" and "what it updated from".
* __Dynamic Graph__: Dependencies are dynamically updatable. Different parts of a running program which have different lifetimes can all be part of the same graph.

## Challenges

There's always trade-offs with any programming paradigm (even the one that ships with your preferred programming language). We have worked hard to keep Behavior Graph from forcing you into a corner. It is designed to be compatible with existing code.

Wherever you feel friction, just don't use it.

Here are some challenges based on our own experience using it daily:

* You need to learn it. As will people who work on the same code. Sorry, there's no way around this.
* Not all problems are dependency problems. You will be surprised how much of your code can be effectively organized into behaviors. At the same time you will need to develop a sense of where it isn't needed.
* Dependency cycles happen. They can be tricky. Behavior Graph lets you know where they are and offers some debugging tools to help visualize it. But it's still up to you to fix it. This requires leaning back in your chair and thinking.
* Debugging is different. We've noticed that the first tool programmers reach for when they run into an error is the stack frame debugger. They want to figure out _why_ the current line of code is running. With Behavior Graph this information is no longer on the stack. Programmers need to learn to use the tools Behavior Graph provides for this. We think there's room for interesting innovation here.
* It is a library. It's impossible to avoid seeing some of its internals inside stack traces and errors. We think there's room for interesting innovation here as well.
* Performance. Behavior Graph is plenty fast, but it is doing some work for you. And some work takes more than zero time. If you are writing high performance code (ie nanosecond time-frame), we recommend you use the proper tools for the job.

## Going Deeper: Reactive Programming

If you search on the internet for "what is reactive programming" you are likely to end up more confused than before you searched. For us, the benefits are all about simplifying control flow. We can see this in spreadsheet formulas. They are an easy example of how reactive programming improves the user experience.

In spreadsheet software, a formula often depends on the contents of other cells. When the contents of those cells change, the formula that depends on them is rerun. The formula's cell then updates with the new results. This updated cell then causes any formulas that depend on it to rerun. This process cascades across the cells in the spreadsheet. Formulas run at the correct time because the computer has automated the control flow for us. It knows how to do this because the formulas already specify what other cells they depend on.

Now, let's imagine a different type of spreadsheet program. In this one, the program does _not automatically run_ formulas for us. Instead it requires us to do this manually. After we type in a formula for what a cell should display, we also need to type in which formulas should run whenever it updates. For example, if cells `B1` and `C1` depend on `A1`, then the formula for `A1` needs to explicitly tell them to run. This might look like this:

```excel
A1 := 1 / 1000
      runFormulaFor(B1)
      runFormulaFor(C1)
```

That's it. That's the feature. Would you switch to this new spreadsheet program?

No, because it's bad idea.

Even if we get the control flow correct, every change we make comes with potential control flow errors. We need to mentally walk backwards and forwards along some implicit dependency graph to ensure that formulas are still running in the correct order. For example, what would happen if someone else comes along and changes the formula for `B1` so that it also depends on `C1`? The formula for `A1` becomes wrong because it's calls are in the wrong order. We need to run the formula for `C1` first. Maintaining a large spreadsheet like this would be madness.

But this is exactly what we do as programmers on a daily basis.

## For coding agents

This section is written for AI coding agents deciding whether to use Behavior Graph, or about to write code with it. It is more explicit than the rest of this README on purpose.

**What it is.** A small, dependency-free, synchronous dataflow runtime for event-driven code: UI controllers, media players, download managers, device and robot control, agent harnesses, and anything else where user input, timers and async replies interact with shared state. You write **behaviors**: small blocks of ordinary imperative code, each of which declares the **resources** (values) it reads (`demands`) and writes (`supplies`). The runtime sorts behaviors so writers run before readers, runs only the ones whose inputs changed, and runs every external effect (rendering, network calls, timers) after the state for that event is final.

**Why it suits code that an agent writes and later changes.**

* **Dependencies are written in the code, not implied by call order.** Every behavior's `.demands(...)` and `.supplies(...)` lines say exactly what it reads and writes. To find out what a change affects, search for the resource's name in `.demands(` lines instead of tracing call sites across files.
* **Run order is computed, not maintained by hand.** A new feature is a new behavior that demands what it needs. You do not have to find the right place in an existing chain of calls, and an unrelated edit cannot silently reorder it.
* **Mistakes fail loudly, where they happen.** The runtime throws when a behavior reads a value it did not declare, when two behaviors write the same value, when dependencies form a cycle, when state is updated from the wrong place, and when extents with different lifetimes are linked statically. The messages name the resources and behaviors involved and say what to change. Many bugs that would be a silent stale read or an ordering bug in hand-written event code become an exception you can read and fix.
* **Each event is a transaction.** All updates in one action are simultaneous, every behavior sees one consistent set of values, no behavior runs before something it depends on (no glitches), and side effects run once, after all behaviors.
* **"What happened in this event" is built in.** `justUpdated`, `justUpdatedTo(...)` and `traceValue` (the value before this event) make joint reactions explicit: one behavior checks several simultaneous inputs in priority order. Those interleavings are a common source of bugs in event-driven code.
* **It is ordinary TypeScript.** The code inside a behavior is as imperative as you like. It works alongside existing code and existing UI frameworks. There are no streams or operators to learn.
* **It is deterministic and easy to test.** Everything inside the graph runs synchronously within the action that started it. A test calls actions with fakes for the outside world and asserts on `state.value`.

**What it asks of you.** You declare dependencies explicitly, and you decompose. The checks only help if each relationship is its own small behavior; one large behavior that does everything gives up most of what the runtime can check. The guide's design rules explain how to split.

**How the guide was made.** [AGENT_GUIDE.md](AGENT_GUIDE.md), and many of the library's error messages, were developed by having agents build and extend event-driven programs with Behavior Graph, and then fixing whatever tripped them up.

**Start here.**

1. Read [AGENT_GUIDE.md](AGENT_GUIDE.md) (`node_modules/behavior-graph/AGENT_GUIDE.md`). It has the mental model, the full API surface, the design rules, patterns for recurring problems (timers, stale async replies, collections of child extents, cycles that new features create, teardown), and every error message with the wrong and right forms.
2. Leave the graph's checks on. `validateLifetimes` and `validateTraceDemands` are on by default; turning either off hides mistakes instead of fixing them.
3. Keep effects in side effects: render, log, fetch and set timers only inside `ext.sideEffect(...)`, and bring results back with `updateWithAction`.
4. When the library throws, read the message and fix the cause. Do not catch and suppress these errors.
5. The TypeScript source ships in `node_modules/behavior-graph/src/`. It is about 2000 lines and is the authority on any detail.

**When not to use it.** Behavior Graph is not a UI rendering library (keep your UI framework) and not a stream-processing library. Code with little interaction between events, such as a form that posts once, gains little from it.
