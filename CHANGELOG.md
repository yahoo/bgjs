# Changelog

## Unreleased

### Added

- **Cleanup on removal from a side effect.** `ext.sideEffect((ext, onRemove) => {...})`
  passes a second argument. `onRemove('timer', () => clearTimeout(t))` registers a cleanup
  under a key, next to the code that starts the work; when the extent is removed, its cleanups
  run newest first in a side effect of the removing event (for `containedLifetimes`, every
  removed extent's do). Registering on an extent that is already removed runs the cleanup at
  once. Teardown no longer needs a `dispose()` method or a `disposed` flag; AGENT_GUIDE.md
  shows the new pattern. The `OnRemove` type is exported.
  - **A key holds one cleanup per extent.** Registering the same key again runs the cleanup it
    held and keeps the new one, so a timer that restarts or a request a newer one replaces
    needs no stored handle and cannot pile up. `onRemove.run(key)` runs a key's cleanup early.
  - **A key belongs to one behavior.** Registering a key that another behavior's side effect
    (or an action's) already registered on the same extent throws and names both, because the
    second would silently cancel the first one's work.
  - **A throwing cleanup does not stop the others.** Every cleanup of the extent runs, then
    the first error is rethrown out of the removing action.
- **`graph.validateMomentReads`** (default `false`). When on, reading `moment.value` during an
  event in which the moment did not update throws an error that names the moment and says to
  check `justUpdated` first, instead of returning `undefined` as if it were an empty payload.
  Off by default because existing code reads the value before checking `justUpdated` (for
  example `moment.value ?? 0`); turn it on in new code. Reads outside any event still return
  `undefined`.
- **Warning when a side effect touches the graph after a synchronous action it started has
  returned.** That code runs outside any event, after the new event has completed, so moments
  read `undefined` and `justUpdated` is false. Reading a resource or starting another action there
  calls `graph.onWarning` once per side effect run, naming the side effect and the events.
  `onWarning` defaults to `console.warn`; set it to `null` to silence it. Queuing a side effect
  there throws, as before, with a message that explains why. The order of events is unchanged:
  the caller still sees a synchronous action.

### Fixes

- **An error from one side effect can no longer be swallowed by another.** When a side effect
  started a synchronous action, the rest of its event ran inside that call, so an error from a
  later side effect surfaced there: a `try`/`catch` around the call hid it, the rest of the event
  was dropped, and the opening action returned normally. Now the call throws "This action never
  ran ..." with the original error as `err.cause`, and the action that opened the event rethrows
  the original even if that is caught. An error from the started action's own event still
  reaches the caller unchanged.

### Changed

- **`justUpdatedTo`, `justUpdatedFrom` and `justUpdatedToFrom` compare with `===`.** They
  used `==` while `update` uses `===`, so `state.justUpdatedTo(null)` was true after an
  update to `undefined`, and `justUpdatedTo(1)` was true after an update to `"1"`. To upgrade,
  pass a value of the same type as the state or moment; code that relied on `null` matching
  `undefined` should check for both.
- **Extent subscriptions end through the same cleanups.** `extent.subscribeToJustUpdated`
  now unsubscribes in the removing event's side effects rather than during removal. Callbacks
  already stopped at removal, so the only observable change is an extent removed and added
  again in one event: a subscription made before the removal still fires once in that event.
  Calling the returned unsubscribe
  early now also drops it from the extent, and subscribing on a removed extent unsubscribes
  at once.
- **`Extent.unsubscribes` and `unsubscribeAll()` are gone.** Both were internal. Subclasses
  may now use those names.

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
