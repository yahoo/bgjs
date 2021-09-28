# Behavior Graph

**Behavior Graph**  is a software library that greatly enhances our ability to program **user facing software** and **control systems**. Programs of this type quickly scale up in complexity as features are added. Behavior Graph directly addresses this complexity by shifting more of the burden to the computer. It works by offering the programmer a new unit of code organization called a **behavior**. Behaviors are blocks of code enriched with additional information about their stateful relationships. Using this information, Behavior Graph enforces _safe use of mutable state_, arguably the primary source of complexity in this class of software. It does this by taking on the responsibility of control flow between behaviors, ensuring they are are _run at the correct time and in the correct order_.

## Is it any good?

Yes

## Documentation

[Introduction to Behavior Graph](bgdocs/typescript/intro.html)

[Behavior Graph Programming Guide](bgdocs/typescript/guide.html)

## Example

To run the example project, clone the repo, and run `npm install` from the examples/browser directory first.

## Requirements

Node/NPM & Typescript

## Installation

Simply add the following dependency to your package.json:

```json
  "dependencies": {
    "@yahoo/behavior-graph": "~0.5"
  }
```

## License

Behavior Graph is available under the Apache 2.0 license. See the LICENSE file for more info.
