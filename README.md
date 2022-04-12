Behavior Graph lets you build your program out of small, easily understood pieces in a way that lets the computer do more of the work for you.

It is an architecture and supporting library that simplifies the type of complexity that comes with event-driven software such as user facing applications and control systems.

It's also a fun way to program.

## Who's it for?

It is particularly helpful for developers building:

* Web app front ends
* Mobile and desktop applications
* Control systems
* Robots

We originally developed it for ourselves to use in a video playing library at Yahoo. Even though we had experienced engineers and excellent test coverage, we still struggled with the complexity of the codebase. Behavior Graph is our solution.

Or maybe you're the type of person who likes nerdy new software ideas. (Seriously though, who doesn't, amirite?) We guarantee you will find Behavior Graph interesting.

## How does it Work?

As programmers it is natural to partition our software into smaller tasks. Consider a typical Login form.
1. When a user clicks on the Login button, we want to validate the Email and Password fields.
2. If validation passes we want to make a network call to log the user in.
3. And we want to update the UI to provide feedback in case the validation fails, or disable the login button while we are actively logging in.
  
Most programming languages offer __functions__ as the primary tool for creating these subtasks. The code for our Login form will have `validateFields`, `networkLogin`, and `updateUI` functions. There will also be an `onLoginClick` function that looks like this:

```javascript
function onLoginClick() {
  validateFields();
  networkLogin();
  updateUI();
}
```

These functions are not independent, however. There are __dependency relationships__ between them that need to be respected.
* `validateFields` depends on `onLoginClick` being run. 
* `networkLogin` depends on `onLoginClick` being run, and it depends on the results of `validateFields`. 
* `updateUI` depends on the results of both `validateFields` and `networkLogin`.

__Functions__ cannot express dependency relationships directly. Instead we must call functions in a particular order to uphold these relationships.
 If we call `networkLogin()` before `validateFields()` the feature won't work. It has to be after. `networkLogin` depends on the validation in `validateFields` succeeding. 
 
 We could partially encode the dependency relationships by using parameters and return values (aka functional programming). This gives us additional structure, but it doesn't remove the need to call these functions in a correct order. Calling something like `networkLogin(validateFields())` is still a sequence of function calls. It's just sideways.

The problem is that expressing dependency relationships in terms of sequenced function calls means work for the developer:
* There's work to get it correct.
* There's work to rearrange calls as dependencies (inevitably) change.
* There's work mentally translating back from sequenced function calls to the original dependency relationships in order to understand the intent of the code.
* And there's work fixing errors whenever any of these efforts go wrong.

But maybe all this work isn't necessary. What if functions _could_ express dependency relationships?

__Behavior Graph__ is a library that provides this alternative. It introduces a new unit of code organization called the __behavior__. It is a block of code together with its dependency relationships.

Unlike functions, behaviors are never called directly. Instead, behaviors declare their interfaces using reactive containers of data called __resources__. When data in these resources changes, Behavior Graph knows that any dependent behaviors need to run. Behaviors together with resources form a graph. (A graph of behaviors! Get it?!)

This gives us:
1. _Control flow for free_: The computer uses the dependency relationships to run our behaviors in the correct sequence. This works just like spreadsheet formulas.
2. _Ease of maintenance_: Requirements inevitably change, and do dependencies. Control flow automatically adapts.
3. _Legibility_: Dependency relationships are explicit. We can look at a behavior and immediately see how it interfaces with other behaviors. This is unlike functions which are often linked via calls made in some other part(s) of the code.

Behavior Graph isn't a replacement for functions. (We wrote it with functions, hello!) Instead it gives us a higher level of abstraction for partitioning our code into subtasks. It lets us say "these two blocks of code are related and here's how". And with that information both humans and the computer are better able to infer the intent of the code.

## Can I see an example?

Behavior Graph introduces a handful of new concepts.
These concepts aren't difficult, but you will require some orientation.

* We've created a [short walk-through of a Login form](https://yahoo.github.io/bgdocs/docs/typescript/code-example/) using Behavior Graph.
* You can also take a look at [one of our tutorials](https://yahoo.github.io/bgdocs/docs/typescript/tutorials/tutorial-1/).

## Small

Behavior Graph is a small library. It's around 1500 lines of formatted code. It has no dependencies. The Javascript is less than 6KB minified + gzip'd.

## Incremental 

It is easy to introduce into a codebase incrementally. It is designed to work side by side with existing code. We gradually migrated Yahoo's video playing library, while in production, as we became confident in Behavior Graph's feature set.

## Scale

A complex codebase is exactly where it brings the most benefit. Our team uses it daily in a codebase where the status quo wasn't good enough.

## Multiplatform

Behavior Graph has been ported to multiple platforms.

* Javascript/Typescript: [bgjs](https://github.com/yahoo/bgjs)
* Objective-C: [bgobjc](https://github.com/yahoo/bgobjc)
* Swift: [BGSwift](https://github.com/yahoo/BGSwift)
* Kotlin/Android: [bgkotlin](https://github.com/yahoo/bgkotlin)

## Obtaining Behavior Graph

Javascript Behavior Graph is hosted on NPM @ [behavior-graph](https://www.npmjs.com/package/behavior-graph).

Behavior Graph is also available via a number of popular CDN Services. You may prefer to use these when importing directly into the browser or with Deno.

* [Skypack.dev](https://www.skypack.dev/view/behavior-graph)
* [JSDelivr](https://www.jsdelivr.com/package/npm/behavior-graph)

## Documentation

[Go here for the full documentation site](https://yahoo.github.io/bgdocs/docs/typescript/tutorials/).

While there are only a handful of basic concepts in Behavior Graph, it does require a shift in thinking. We recommend you start with the [Getting Started guide](https://yahoo.github.io/bgdocs/docs/typescript/quickstart/) then work through the [Tutorials](https://yahoo.github.io/bgdocs/docs/typescript/tutorials/tutorial-1/).

## Contact Us

We really do like talking about Behavior Graph.
Discord is a good place for that.

[Behavior Graph Discord](https://discord.gg/5mvat8tc7d)

## Contributing

* Yes there are many interesting areas for contribution. Please ask us.
* Don't just make a pull request. We would prefer to let you know upfront if your idea is unlikely to be accepted.

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
