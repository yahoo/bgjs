# Changelog

## 3.0.0 (unreleased)

### Breaking changes

- **`graph.validateMomentReads` is on by default, and `Moment.value` is typed `T`.** Reading
  `moment.value` when the moment did not update in the current event, or outside any event,
  now throws an error naming the moment; it used to return `undefined`. The type is `T`
  instead of `T | undefined`, so the `!` in `moment.value!` is no longer needed. To upgrade,
  read the value only when `moment.justUpdated` is true: replace `moment.value ?? fallback`
  with `moment.justUpdated ? moment.value : fallback`, and in tests assert on what the
  behaviors did instead of reading the moment after the action. To run 2.x code unchanged
  while migrating, set `graph.validateMomentReads = false` (the type is still `T`).
- **`moment.update()` and `updateWithAction()` require a value when the payload type does
  not include `undefined`.** `this.moment<number>().update()` is now a type error. Moments
  without a payload (`this.moment()`) are unchanged.
- **`justUpdatedTo`, `justUpdatedFrom` and `justUpdatedToFrom` compare with `===`.** They
  used `==` while `update` uses `===`, so `state.justUpdatedTo(null)` was true after an
  update to `undefined`, and `justUpdatedTo(1)` was true after an update to `"1"`. To upgrade,
  pass a value of the same type as the state or moment; code that relied on `null` matching
  `undefined` should check for both.

### Added

- **`graph.validateMomentReads`** (default `true`), the switch for the moment-read check above.

## 2.0.0 (2026-10-08)

### Breaking changes

- **`graph.validateTraceDemands` is on by default.** Inside a behavior, reading
  `state.traceValue` or `state.traceEvent` now throws unless the behavior supplies the state,
  demands it (plain or `.order`), or declares `state.trace` in its demands. To upgrade, add
  `this.x.trace` to the demands of each behavior the error names. To run 1.x code unchanged
  while migrating, set `graph.validateTraceDemands = false`.
- **A second `.demands()` or `.supplies()` call on a behavior builder adds to the list.** It
  used to replace it, so `.demands(a).demands(b)` silently dropped `a`.
- **A second `.dynamicDemands()` or `.dynamicSupplies()` call on a behavior builder throws.**
  Put every switch in one call and return all links from one function.
- **A behavior whose every demand is `.trace` throws from `.runs()`.** Such a behavior could
  never run.
- **`addToGraph()` throws when a subclass field hides an `Extent` member** (`state`, `moment`,
  `action`, `graph`, `behaviors`, `addedToGraph`, ...). Rename the field.
- **Removed extents stay removed.** Their behaviors no longer run, updating one of their
  resources does nothing, and `addedToGraph` goes back to `false` on removal. Previously a
  later update to a removed extent's resource (a queued UI event, a late timer) ran its
  behaviors again. Adding and removing an extent in the same event is now allowed.
- **Internal members are no longer in the type files.** Graph, Behavior, BehaviorBuilder and
  Resource internals (`actionHelper`, `addExtent`, `untrackedDemands`, ...) are marked
  `@internal` and left out of the published `.d.ts` files, so TypeScript code that used them
  no longer compiles. They still exist at runtime. Extent's internal fields stay visible so
  that a subclass field with the same name is still a type error.
- **Error messages changed.** Graph errors now name the resources and behaviors involved and
  say how to fix the problem. The `err` properties (`err.cycle`, `err.alreadySupplied`,
  `err.desiredSupplier`, `err.resource`, ...) are unchanged, but code or tests that match
  message text need updating.

### Added

- **`state.trace` demands.** `.demands(this.a, this.b.trace)` lets a behavior read
  `b.traceValue` (the value from before this event) without an edge to `b`'s supplier: it
  never orders or activates the behavior and cannot form a cycle. Works in `dynamicDemands`.
- **Doc comments on the public API**, so editors and agents reading the type files see what
  each class and member does.
- **`Demandable` and `BehaviorBuilder` are exported**, for helpers that take demands or build
  behaviors.
- **`AGENT_GUIDE.md`**, a single-page reference for coding agents (mental model, API, design
  rules, patterns, and every error message with its fix). It ships in the package at
  `node_modules/behavior-graph/AGENT_GUIDE.md`.

### Fixed

- The ESM build (`lib/mjs`) failed to load in plain Node with `ERR_MODULE_NOT_FOUND` because
  four internal imports had no `.js` extension.
- After a removed extent's behavior was skipped, the next queued behavior could run before
  its dynamic demands were relinked, so a `dynamicDemands` aggregate over a child list could
  throw an undeclared-read error.

## Earlier versions

See the [GitHub releases](https://github.com/yahoo/bgjs/releases) for 1.4.0 and earlier.
