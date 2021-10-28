# Behavior Graph

**Behavior Graph**  is a software library that greatly enhances our ability to program **user facing software** and **control systems**. Programs of this type quickly scale up in complexity as features are added. Behavior Graph directly addresses this complexity by shifting more of the burden to the computer. It works by offering the programmer a new unit of code organization called a **behavior**. Behaviors are blocks of code enriched with additional information about their stateful relationships. Using this information, Behavior Graph enforces _safe use of mutable state_, arguably the primary source of complexity in this class of software. It does this by taking on the responsibility of control flow between behaviors, ensuring they are are _run at the correct time and in the correct order_.

## Is it any good?

Yes

## Documentation

[Introduction to Behavior Graph](https://yahoo.github.io/bgdocs/docs/typescript/intro.html)

[Behavior Graph Programming Guide](https://yahoo.github.io/bgdocs/docs/typescript/guide.html)

## Example

To run the example project, clone the repo, and run `npm install` from the examples/browser directory first.

## Requirements

Node/NPM & Typescript

## Installation

If you are using Node/NPM, simply add the following dependency to your package.json:

```json
  "dependencies": {
    "behavior-graph": "~0.5"
  }
```

Then access the object through an import or require

```js
import * as bg from 'behavior-graph';
```

Or, if you want to import directly into the browser

```html
<script src="https://cdn.jsdelivr.net/npm/behavior-graph/lib/behavior-graph.min.js" />
````

Then the following should run in node or the browser

```js
let g = new bg.Graph();
let e = new bg.Extent(g);
let m = new bg.Moment(e);
e.makeBehavior([m], null, (extent) => {
   console.log("Hello, World!"); 
});

e.addToGraphWithAction();

g.action(null, () => {
    m.update();
});
```

## License

Behavior Graph is available under the Apache 2.0 license. See the LICENSE file for more info.
