# Behavior Graph Concept Renaming Plan

## Overview

This document outlines a comprehensive plan to rename core concepts in the Behavior Graph library. The renaming requires careful coordination across code, tests, documentation, and examples to maintain functionality throughout the process.

## Renaming Summary

| Current Term | New Term | Complexity |
|-------------|----------|------------|
| resource | signal | High - Core concept, pervasive usage |
| moment resource | event signal | Medium - Type-specific |
| state resource | state signal | Medium - Type-specific |
| demands | dependencies and dependsOn | Medium - API change |
| event | moment | High - Conflicts with existing "moment" |
| event loop | action loop | Medium - Internal implementation + docs |
| side effect | effect | Medium - API change |

## Critical Challenge: Event/Moment Swap

The most complex part is swapping "event" and "moment" because:
- Current "moment" resources will become "event" signals
- Current "event" (GraphEvent, .event property) will become "moment"
- We cannot rename one then the other due to naming conflicts
- Solution: Use temporary names during transition

## Incremental Plan

### Phase 1: Preparation and Infrastructure
**Goal:** Set up safe renaming infrastructure without breaking changes

#### Step 1.1: Add Temporary Names for Event/Moment Swap
- Add type aliases and alternative names in `src/common.ts`:
  - `TempMoment` as alias for `GraphEvent`
  - `TempEvent` as alias for current `Moment` class
- Annotate every alias with JSDoc `@deprecated` tags and a shared warning helper so usages surface during tooling
- **Files to modify:**
  - `src/common.ts`
  - `src/resource.ts` (add TempEvent alias)
  - `src/index.ts` (export new aliases)
- **Test:** Run `npm test` to ensure no regressions

#### Step 1.2: Add Signal Aliases
- Add `Signal` as alias for `Resource` in `src/resource.ts`
- Add `EventSignal` as alias for `Moment`
- Add `StateSignal` as alias for `State`
- Update exports in `src/index.ts`
- Mark all aliases with `@deprecated` and ensure TypeScript declaration files emit the tags
- **Test:** Run `npm test` to ensure no regressions

#### Step 1.3: Add Dependencies Aliases
- Add `dependencies()` method as alias for `demands()` in `src/behavior.ts`
- Add `dependsOn()` method with same functionality
- Decorate each alias with `@deprecated` annotations or runtime warnings (behind a dev flag) to guide migration
- **Test:** Run `npm test` to ensure no regressions

#### Step 1.4: Add Effect Alias
- Add `effect()` method as alias for `sideEffect()` in behaviors
- Update relevant files where `sideEffect` is implemented
- **Test:** Run `npm test` to ensure no regressions

#### Step 1.5: Communicate In-Progress Terminology Changes
- Add a short note to `README.md` explaining that terminology is being migrated and both names appear temporarily
- Link to this plan or the tracking issue so users understand the transition
- Remove the note during Phase 7 once new terminology is fully rolled out
- Document that all legacy APIs are explicitly marked deprecated and scheduled for removal after the migration window

### Phase 2: Update Core Implementation
**Goal:** Migrate implementation to use new names internally

**Testing cadence:** Use quick checks (TypeScript build or targeted Jest paths) after each step, then run the full `npm test` suite after Step 2.3 and again after Step 2.8 to catch regressions without excessive repetition.

#### Step 2.1: Migrate Event → Moment (GraphEvent → TempMoment)
- Rename `GraphEvent` → `TempMoment` in `src/common.ts`
- Update all internal usage of GraphEvent to TempMoment
- Keep `GraphEvent` exported as a deprecated alias with explicit deprecation annotations and references to the replacement
- **Files to modify:**
  - `src/common.ts`
  - `src/graph.ts`
  - `src/resource.ts`
  - `src/behavior.ts`
  - `src/extent.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.2: Migrate Moment → Event (Moment class → Event class)
- Rename `Moment` class → `TempEventInternal` (temporary name)
- Update all internal references
- Keep `Moment` as deprecated alias pointing to `TempEventInternal`, marked with `@deprecated`
- **Files to modify:**
  - `src/resource.ts`
  - `src/extent.ts`
  - Update any internal method signatures
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.3: Final Event/Moment Swap
- Rename `TempEventInternal` → `Event`
- Rename `TempMoment` → `Moment`
- Update internal usage to prefer `.moment` while keeping a deprecated `.event` accessor that forwards to `.moment`
- Rename helper fields and methods such as `lastEvent`, `currentEvent`, and `traceEvent` to their `Moment` equivalents while keeping deprecated shims
- Keep old names as deprecated aliases
- **Files to modify:**
  - `src/resource.ts`
  - `src/common.ts`
  - Update all property references
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.4: Migrate Resource → Signal
- Rename `Resource` class → `Signal` in `src/resource.ts`
- Update all internal usage
- Keep `Resource` as deprecated alias clearly annotated and routed through a shared deprecation helper to log guidance in development builds
- **Files to modify:**
  - `src/resource.ts`
  - `src/behavior.ts`
  - `src/extent.ts`
  - `src/graph.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.5: Migrate Type-Specific Names
- Rename `State` → `StateSignal` in implementation
- Rename `Event` (former Moment) → `EventSignal` in implementation
- Keep old names as deprecated aliases annotated and routed through the same deprecation helper
- **Files to modify:**
  - `src/resource.ts`
  - Update extent factory methods
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.6: Migrate Demands → Dependencies
- Update behavior implementation to use `dependencies` internally
- Update `demands` to call `dependencies` for backward compatibility
- **Files to modify:**
  - `src/behavior.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.7: Migrate SideEffect → Effect
- Update behavior implementation to use `effect` internally
- Update `sideEffect` to call `effect` for backward compatibility
- **Files to modify:**
  - `src/behavior.ts`
  - `src/extent.ts` (if sideEffect defined there)
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.8: Migrate Event Loop → Action Loop (Internal Implementation)
- Rename internal event loop concepts to action loop:
  - `eventLoop()` method → `actionLoop()`
  - `eventLoopState` property → `actionLoopState`
  - `EventLoopState` class → `ActionLoopState`
  - `EventLoopPhase` enum → `ActionLoopPhase`
- Update all internal references and comments
- **Files to modify:**
  - `src/graph.ts` (main implementation)
  - `src/__tests__/behavior-graph.test.ts` (test references)
- **Test:** Run `npm test` to ensure functionality preserved

### Phase 3: Update Tests
**Goal:** Migrate all tests to use new terminology

#### Step 3.1: Update Unit Tests - Core
- Update `src/__tests__/behavior-graph.test.ts`
  - Replace Resource → Signal
  - Replace Moment → EventSignal  
  - Replace State → StateSignal
  - Replace demands → dependencies
  - Replace sideEffect → effect
  - Replace .event → .moment
  - Replace GraphEvent → Moment
  - Replace eventLoop → actionLoop
  - Replace EventLoopState → ActionLoopState
  - Replace helper usages (`lastEvent`, `currentEvent`, `traceEvent`, etc.) with their new moment terminology
  - Replace EventLoopPhase → ActionLoopPhase
- **Test:** Run `npm test` to ensure all tests pass

#### Step 3.2: Update Unit Tests - Resource Tests
- Update any resource-specific tests
- Update moment/state specific tests
- **Files to modify:**
  - `src/__tests__/vending.test.ts`
  - Any other test files with resource usage
- **Test:** Run `npm test` to ensure all tests pass

#### Step 3.3: Update Documentation Tests
- Update `src/__tests__/documentation.test.js`
- Update `src/__tests__/docs-code-example.test.js`
- **Test:** Run `npm test` to ensure all tests pass

### Phase 4: Update Documentation
**Goal:** Migrate all documentation to new terminology

#### Step 4.1: Update Core Documentation
- Update `BGforLLMs-Core.md`
  - Replace "resource" with "signal" throughout
  - Replace "moment resource" with "event signal"
  - Replace "state resource" with "state signal"
  - Replace "demands" with "dependencies"
  - Replace "event loop" with "action loop"
  - Replace "side effect" with "effect"
  - Update the event/moment terminology carefully
- **Test:** Review for consistency and clarity

#### Step 4.2: Update JavaScript Documentation
- Update `BGforLLMs-JavaScript.md`
  - Apply same terminology changes as core docs
  - Update all code examples
  - Update API references
  - Replace GraphEvent → Moment
  - Replace "event loop" → "action loop" in explanations
- **Test:** Review for consistency and clarity

#### Step 4.3: Update README
- Update `README.md`
  - Update high-level concept descriptions
  - Ensure terminology consistency
- **Test:** Review for consistency and clarity

#### Step 4.4: Update Contributing Documentation
- Update `CONTRIBUTING.md` if it contains relevant terminology
- Update any other documentation files
- **Test:** Review for consistency

### Phase 5: Update Examples
**Goal:** Migrate all examples to use new terminology

#### Step 5.1: Update Browser Example
- Update `examples/browser/main.js`
- Update `examples/browser/app.js`
- Update any HTML files with terminology
- **Files to modify:**
  - `examples/browser/main.js`
  - `examples/browser/app.js`
  - `examples/browser/public/hello.html`
- **Test:** Run browser example to ensure it works

#### Step 5.2: Update React App Example
- Update all files in `examples/reactapp/src/`
- **Files to modify:**
  - `examples/reactapp/src/CounterExtent.js`
  - `examples/reactapp/src/AllCountersExtent.js`
  - Other React component files
- **Test:** Run react app example to ensure it works

#### Step 5.3: Update TodoMVC Examples
- Update `examples/todomvc/js/` files
- Update `examples/todomvc-react/js/` files
- **Files to modify:**
  - `examples/todomvc/js/ListExtent.js`
  - `examples/todomvc/js/ItemExtent.js`
  - `examples/todomvc/js/ItemView.js`
  - `examples/todomvc/js/ListView.js`
  - Similar files in todomvc-react
- **Test:** Run TodoMVC examples to ensure they work

#### Step 5.4: Update Performance Tests
- Update `examples/perftests/src/index.ts`
- **Test:** Run performance tests to ensure they work

### Phase 6: Update Exports and Public API
**Goal:** Update primary exports to use new names

#### Step 6.1: Update Primary Exports
- Update `src/index.ts` to export new names as primary
- Keep old names as deprecated aliases
- Document any aliases slated for removal by creating follow-up issues or TODOs so they do not linger indefinitely
- **Files to modify:**
  - `src/index.ts`
- **Test:** Run `npm test` to ensure backward compatibility

#### Step 6.2: Update Build Configuration
- Verify build process works with new names
- Update any build scripts that reference old names
- **Test:** Run `npm run build` to ensure clean build

### Phase 7: Final Validation
**Goal:** Ensure everything works and is consistent

#### Step 7.1: Full Test Suite
- Run complete test suite: `npm test`
- Run test coverage: `npm run test-coverage`
- Verify all tests pass with new terminology
- Capture changelog notes and draft a release summary communicating renamed APIs and deprecation timelines

#### Step 7.2: Build Verification
- Run full build: `npm run build`
- Verify generated files use new terminology
- Test generated bundles

#### Step 7.3: Example Verification
- Test all examples manually
- Verify they work with renamed concepts
- Check for any remaining old terminology
- Remove the temporary README note added in Phase 1 once verification passes

#### Step 7.4: Documentation Review
- Final review of all documentation
- Ensure terminology is consistent throughout
- Verify code examples match current API
- Remove or update any references to deprecated helper names such as `lastEvent`, `currentEvent`, and `traceEvent`

## Risk Mitigation

### Backward Compatibility
- All old names maintained as deprecated aliases
- Gradual migration allows catching issues early
- Extensive testing at each step
- Track planned alias removals with TODO comments or GitHub issues created in Phase 6 so their lifecycle is explicit

### Testing Strategy
- Run tests after each step
- Manual verification of examples
- Build verification throughout process

### Rollback Plan
- Each step is atomic and reversible
- Git commits at each step allow rollback
- Aliases allow gradual migration for users

## Success Criteria

1. **Functionality Preserved:** All tests pass throughout migration
2. **Examples Work:** All examples function with new terminology
3. **Documentation Updated:** All docs consistently use new terms
4. **Backward Compatible:** Old API still works with deprecation warnings
5. **Build Success:** Clean build with new terminology
6. **Type Safety:** TypeScript compilation succeeds throughout

## Timeline Estimation

- **Phase 1 (Preparation):** 4 steps × 30 minutes = 2 hours
- **Phase 2 (Core Implementation):** 8 steps × 45 minutes = 6 hours  
- **Phase 3 (Tests):** 3 steps × 30 minutes = 1.5 hours
- **Phase 4 (Documentation):** 4 steps × 45 minutes = 3 hours
- **Phase 5 (Examples):** 4 steps × 30 minutes = 2 hours
- **Phase 6 (Exports):** 2 steps × 15 minutes = 30 minutes
- **Phase 7 (Validation):** 4 steps × 30 minutes = 2 hours

**Total Estimated Time:** ~16.75 hours

## Internal Implementation Details

### Event Loop → Action Loop Specifics
The following internal components need renaming in `src/graph.ts`:
- `eventLoop()` private method (line ~94)
- `eventLoopState` property (line ~49) 
- `EventLoopState` class (line ~765)
- `EventLoopPhase` enum (line ~758)
- All references in comments about "event loop"
- Test references in `src/__tests__/behavior-graph.test.ts`

This is more than just documentation - it's core internal implementation that manages the execution cycle.

## Notes for Implementation

1. **Commit Strategy:** Commit after each step with descriptive messages
2. **Testing:** Always run tests before committing each step
3. **Documentation:** Update inline code comments as you go
4. **Caution Areas:** 
   - Event/moment swap requires extra care
   - Property renames (`.event` → `.moment`) need thorough testing
   - Export changes could affect downstream users

5. **Priority Order:** Follow the phases in order - infrastructure first, then implementation, then user-facing changes

This plan ensures a systematic, safe migration with minimal risk and maximum backward compatibility.
