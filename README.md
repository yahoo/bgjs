Behavior Graph is a software architecture and state management library. It greatly enhances your ability to write complex user facing software and control systems. Broadly speaking, it belongs to the category of libraries which includes Redux, MobX, Rx (Reactive Extensions), and XState. It works by providing a specialized unit of composition which we call the __behavior__. Behaviors are simple blocks of code together with their dependency relationships.

## [Please See the full Documentation Site](https://yahoo.github.io/bgdocs/typescript)

## Is it any good?

Yes

## Highlights

* Minimal boilerplate
* Scales from the simple to the very complex
* Incremental adoption: works alongside existing code and frameworks
* Handles state, events, and effects all in one
* Multi-platform (Javascript/Typescript, Kotlin, Objective-C, Swift)

We developed Behavior Graph to address our own complexity challenges while building an iOS video playing library which is used internally throughout the suite of native Yahoo mobile apps. After years of development and production usage, it has proven to be incredibly competent at scale. We have since ported it to multiple languages including Javascript/Typescript. It is less than 1500 lines of code and contains no external dependencies.

Behavior Graph will particularly appeal to anyone with a willingness to rethink how we write software applications.

## What does it look like?

The below block of code implements a simple counter using Behavior Graph.
It can increment the counter or reset it back to zero.

About 70% of the concepts you need to work with Behavior Graph are contained in this one example.

<!-- Intro-1 -->
```javascript
this.increment = this.moment();
this.reset = this.moment();
this.counter = this.state(0);

this.behavior()
  .demands(this.increment, this.reset)
  .supplies(this.counter)
  .runs(() => {
    if (this.increment.justUpdated) {
      this.counter.update(this.counter.value + 1);
    } else if (this.reset.justUpdated) {
      this.counter.update(0);
    }
  });
```

A typical Behavior Graph program consists of dozens or hundreds of behaviors like this, each with its own responsibilities.
The Behavior Graph library then ensures these behaviors are correctly specified and runs them at the correct time and in the correct order.
At scale this is shockingly effective.

## Is it for me?

Behavior Graph is a general purpose library which you can use to organize the event driven logic in any program.
It should also be of interest to anyone with an interest in software engineering and architectures.

Specifically if you are working on any of these categories, you should definitely consider it:

* Web apps
* Mobile apps
* Desktop Applications
* User Interfaces
* Control Systems
* Robots
* Games

## Learning Behavior Graph

While there are only a handful of basic concepts in Behavior Graph, it does require a shift in thinking.
[Please See the full Documentation Site](https://yahoo.github.io/bgdocs/typescript)