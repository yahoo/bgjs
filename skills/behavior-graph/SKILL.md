---
name: behavior-graph
description: Write or change event-driven TypeScript or JavaScript with the behavior-graph library, where user input, timers and async replies interact with shared state (UI controllers, media players, download managers, device control, agent harnesses). Use when a project depends on behavior-graph, or when choosing how to structure that kind of state and effect logic.
---

# Behavior Graph

`behavior-graph` is a synchronous dataflow runtime. You write behaviors: small blocks of
ordinary code that each declare what they read (`demands`) and write (`supplies`). The
runtime runs them in dependency order once per event and runs side effects after the state
for that event is final. Mistakes such as undeclared reads, two writers, and cycles throw
errors that say what to change.

## When it fits

Use it for logic where several inputs (clicks, timers, network replies, device events)
interact with shared state and the right order of updates is easy to get wrong. Keep the
existing UI framework; Behavior Graph sits underneath it. It adds little to code with
little interaction between events, such as a form that posts once.

## Before writing code

1. Install it if needed: `npm install behavior-graph`.
2. Read `node_modules/behavior-graph/AGENT_GUIDE.md`. It matches the installed version and
   has the API, the design rules, patterns for recurring problems, and every error message
   with its fix. If the package is not installed yet, read
   https://raw.githubusercontent.com/yahoo/bgjs/master/AGENT_GUIDE.md.
3. The source in `node_modules/behavior-graph/src/` is the authority when the guide is unclear.

## Rules that matter most

- Set `graph.validateTraceDemands = true` on every `Graph`.
- One relationship per behavior. A large behavior that does everything gives up most of
  what the runtime can check.
- Render, log, fetch and set timers only inside `ext.sideEffect(...)`. Bring results back
  with `updateWithAction`.
- When the library throws, read the message and fix the cause. Do not catch and suppress it.
