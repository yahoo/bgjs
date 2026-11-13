---
name: behavior-graph-explore
description: Search every input order of a behavior-graph program, up to a depth, for one that breaks a property, then read the failing sequence as a trace. Use to harden a graph where inputs, async replies or timers can interleave, to find the inputs behind a bug you cannot reproduce, or to confirm a fix holds in every order rather than the one a test tried.
---

# Exploring a Behavior Graph

`bg-explore` runs the real graph over every sequence of the inputs you list, up to a depth,
and checks properties after each step. A failure comes back as the shortest input sequence
that breaks one, replayed with `bg-trace` so you can read each event. Tests check the orders
someone thought of. Exploring checks all of them within the bound.

The tool is in the bgjs repository at `tools/explore` (it uses `tools/trace` beside it); it is
not in the npm package. Once per clone: build the library at the repository root
(`npm install && npm run build`; `lib/` is not checked in and the tool imports it), then run
`npm install` in `tools/explore`. To read the trace it prints, follow the
`behavior-graph-trace` skill (`skills/behavior-graph-trace`).

## Steps

1. **Write a spec** (`tools/explore/README.md` has the shape; `examples/search.mjs` is a
   complete one). Put it in the project so its imports resolve, and pass the project's
   `behavior-graph` module as `bg`.
   - `setup()` builds a fresh system: every graph and extent, and fakes for the outside world
     (a server with a pending list, timers, a clock) that side effects write to.
   - `actions` are the inputs, each with a small domain: two or three values that matter
     (two queries, `oldest`/`newest` reply). A reply, timer fire or completion from the fakes
     is an action too, enabled only when something is pending. This is where interleavings
     come from. Steps must be synchronous: explore never runs work after an `await`, in a
     `.then` or in a timer.
   - `envKey` returns the fakes' state. Anything a later step depends on and the graph does
     not hold goes here, including state in `#private` fields or closures, which the hasher
     cannot see (or keep it in a `State`).
   - Time and randomness throw while explore runs: inject a fixed `dateProvider` or clock,
     and pass random choices in as inputs.

2. **Write the properties** as `checks` (return a message when one fails) or as a behavior
   that throws. State what must always hold, in the spec's own words: "once nothing is
   pending, the results are for the current query", "at most one request in flight", "the
   player is never playing while unloaded". A property that names no particular input order
   finds bugs nobody wrote a test for.

3. **Make it go red first** when you are chasing a known bug: run against the unfixed code
   and confirm the property fails. A spec that passes on the bug cannot vouch for the fix.

4. **Run it**: `node <bgjs>/tools/explore/bin/bg-explore.js spec.mjs`. Start at depth 4 to 6;
   raise `--depth` while each run takes seconds. `--reduction sleep` skips orders of steps
   that touch disjoint graph resources; any step that changes the fakes (`envKey`) or a plain
   extent field counts as touching everything, so with fakes it rarely helps. `exploreTouch`
   is not needed. `cone` (hash only what the checks read) is an error if a step, `enabled()`
   or check reads a resource outside it, and does not hash plain extent fields, so keep it
   for graph-only state.

5. **On a violation**, read the counterexample's trace: the step where the property broke,
   which behavior updated the wrong value, and `because` what. Fix the cause in the graph
   (a demand, an ownership, a check on a reply's id), not the property.

6. **Re-run at the same depth.** Done when it reports no violation, the search was not
   `TRUNCATED`, and step 3 showed the spec catches the bug. Copy each counterexample into the
   project's tests as a fixed sequence of actions, so the case stays covered without the tool.

## Reading the result

- `No violation found ... depth 6 of 6 completed` covers every sequence of the given inputs up
  to 6 steps. It says nothing about inputs not listed or longer sequences; say so when you
  report it.
- `TRUNCATED at maxStates` (exit 3) means the search stopped early: not a pass. Shrink the
  domains or the depth, or use `--mode random --walks 5000`.
- `explore stopped: ...` (exit 2) is a spec mistake explore caught (async work, a graph it
  cannot see, a read outside the cone, another copy of behavior-graph); the message says
  the fix.
- `Something is not deterministic` means state outside the graph is missing from `envKey`, or
  `setup()` shares something between systems.
- `--html cex.html` writes the counterexample as a step-through replay for a person.
