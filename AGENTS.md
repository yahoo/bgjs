# behavior-graph (bgjs)

The JavaScript/TypeScript Behavior Graph library. `src/` is the whole library; `examples/` and
`react-behavior-graph/` are separate packages with their own `package.json`. User-facing
documentation is `README.md`, and `AGENT_GUIDE.md` for agents that *use* the library. This file
is for working *on* it.

## Checks

After changing anything in `src/`, run all three; each catches what the others miss:

1. `npm test`: jest on `src/` through ts-jest.
2. `npm run build`: emits `lib/` (ESM, CJS, bundle). Other projects and the type check read
   `lib/`, not `src/`, so rebuild before using them.
3. `npm run test-types`: compiles `test-types/consumer.mts` against the built `lib/mjs` types with
   library checking on. It fails when a published `.d.ts` refers to something stripped as
   `@internal`, or when public API used by typical code disappears.

## Conventions the code does not enforce

- **Relative imports end in `.js`** (`from "./common.js"`). ts-jest and bundlers resolve them
  without it; plain Node loading `lib/mjs` does not.
- **Public API carries a doc comment; internals carry `/** @internal */`.** `stripInternal` leaves
  internals out of the published types. Exception: `Extent`'s internal *fields* stay visible
  with an "Internal: ..." comment, because users subclass `Extent` and a visible field keeps a
  clashing subclass field a type error. A member that a public declaration needs (an
  `implements` member, a type in a public signature) must stay visible too; `test-types` tells
  you.
- **Every new member on `Extent` is a name users can no longer use for a field.** `addToGraph`
  throws when a subclass field hides an `Extent` method or core field, so adding one is a
  breaking change for subclasses that already use that name. Prefer a module function or a
  member of an internal class.
- **Error messages are API.** Agents and people often see only the message, so each one names
  the resources and behaviors involved and says how to fix the problem. The text lives in
  `src/errors.ts`; `src/__tests__/errors.test.ts` asserts the names it must contain. Keep the
  `err.*` properties (`err.cycle`, `err.resource`, ...) stable when wording changes.

## When behavior or errors change

- **`AGENT_GUIDE.md`**: update the API listing (section 2) and the pitfalls with their exact
  error text (section 5). Its skeleton and collection examples are copied verbatim into
  `src/__tests__/agent-guide.test.ts`, which runs them and fails if the copies differ; change
  both together.
- **`CHANGELOG.md`**: add an entry under the unreleased version. A breaking change says how to
  upgrade.
- **Docs-site snippets**: the tagged regions in `src/__tests__/documentation.test.js`
  (`tag-start: Name` ... `tag-end`) and `docs-code-example.test.js` (`tag::name[]` ...
  `end::name[]`) match snippets on the docs site (yahoo/bgdocs). Keep the tag names, and keep
  the code in step with the site.
