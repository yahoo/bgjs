# Behavior Graph Concept Renaming Plan

## Overview

This document outlines a comprehensive plan to rename core concepts in the Behavior Graph library. The renaming requires careful coordination across code, tests, documentation, and examples to maintain functionality throughout the process.

## 🎉 PROGRESS STATUS

### ✅ COMPLETED PHASES:
- **Phase 1: Preparation and Infrastructure** - All aliases and backward compatibility infrastructure in place
- **Phase 2: Update Core Implementation** - All core classes and internal implementation migrated to new terminology

### 🔄 REMAINING PHASES:
- **Phase 2B: Final API Updates** - Additional API changes before test migration
- **Phase 3: Update Tests** - Convert test files to use new terminology
- **Phase 4: Update Documentation** - Update all documentation files
- **Phase 5: Update Examples** - Update example applications  
- **Phase 6: Update Exports and Public API** - Make new names primary exports
- **Phase 7: Final Validation** - Complete testing and validation

**Current Status:** Core infrastructure migration complete! All 156 tests passing. Ready for Phase 2B additional API updates.

## 📝 IMPORTANT IMPLEMENTATION NOTES FOR NEXT AGENT

### Key Implementation Decisions Made:

1. **Event/Moment Swap Strategy**: 
   - Used `ActionMoment` as the final name for the timestamp class (former `GraphEvent`)
   - This avoided naming conflicts with the legacy `Moment` type alias for event signals
   - `ActionMoment` is exported and used internally; `GraphEvent` remains as deprecated alias

2. **Conservative Behavior Class Approach**:
   - Kept `Behavior` class properties as `demands`, `orderingDemands`, `untrackedDemands`, etc.
   - Only updated `BehaviorBuilder` to use `dependencies` internally
   - This avoided massive changes to `graph.ts` which has complex behavior management logic
   - Added backward compatibility methods like `dynamicDemands()` that call `dynamicDependencies()`

3. **Class Hierarchy Successfully Migrated**:
   - `Resource` → `Signal` (complete with `isSignal` property)
   - `Moment` → `EventSignal` (complete)
   - `State` → `StateSignal` (complete)
   - All old names work as deprecated type aliases

4. **Internal Property Names**:
   - Graph: `actionLoopState`, `ActionLoopPhase`, `ActionLoopState` class
   - Event signals: `.moment` property added, `.event` deprecated but functional
   - Extent: uses new class constructors (`new StateSignal`, `new EventSignal`)

### What Still Uses Old Names Internally:

1. **Behavior class properties**: `demands`, `orderingDemands`, `untrackedDemands` 
   - Reason: Massive `graph.ts` refactor avoided for stability
   - Impact: Only affects internal implementation, APIs work correctly

2. **Graph method names**: `updateDemands()`, `setDynamicDemands()`
   - Reason: These work correctly with the current implementation
   - Impact: Internal only, no user-facing effect

3. **Some debug strings and comments**: May still reference old terminology
   - Impact: Low priority, cosmetic only

### Aliases That Work Perfectly:
- All user-facing APIs: `demands()` → `dependencies()`, `sideEffect()` → `effect()`
- All class names: `Resource` → `Signal`, `Moment` → `EventSignal`, etc.
- All deprecated names have proper JSDoc `@deprecated` annotations

### Test Compatibility:
- All tests pass without modification using old terminology
- Some tests were updated to use new class constructors where necessary
- Test infrastructure ready for Phase 3 migration to new terminology

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

### Phase 1: Preparation and Infrastructure ✅ COMPLETED
**Goal:** Set up safe renaming infrastructure without breaking changes

#### Step 1.1: Add Temporary Names for Event/Moment Swap ✅ COMPLETED
- Add type aliases and alternative names in `src/common.ts`:
  - `TempMoment` as alias for `GraphEvent`
  - `TempEvent` as alias for current `Moment` class
- Annotate every alias with JSDoc `@deprecated` tags and a shared warning helper so usages surface during tooling
- **Files to modify:**
  - `src/common.ts`
  - `src/resource.ts` (add TempEvent alias)
  - `src/index.ts` (export new aliases)
- **Test:** Run `npm test` to ensure no regressions

#### Step 1.2: Add Signal Aliases ✅ COMPLETED
- Add `Signal` as alias for `Resource` in `src/resource.ts`
- Add `EventSignal` as alias for `Moment`
- Add `StateSignal` as alias for `State`
- Update exports in `src/index.ts`
- Mark all aliases with `@deprecated` and ensure TypeScript declaration files emit the tags
- **Test:** Run `npm test` to ensure no regressions

#### Step 1.3: Add Dependencies Aliases ✅ COMPLETED
- Add `dependencies()` method as alias for `demands()` in `src/behavior.ts`
- Add `dependsOn()` method with same functionality
- Decorate each alias with `@deprecated` annotations or runtime warnings (behind a dev flag) to guide migration
- **Test:** Run `npm test` to ensure no regressions

#### Step 1.4: Add Effect Alias ✅ COMPLETED
- Add `effect()` method as alias for `sideEffect()` in behaviors
- Update relevant files where `sideEffect` is implemented
- **Test:** Run `npm test` to ensure no regressions

#### Step 1.5: Communicate In-Progress Terminology Changes ✅ COMPLETED
- Add a short note to `README.md` explaining that terminology is being migrated and both names appear temporarily
- Link to this plan or the tracking issue so users understand the transition
- Remove the note during Phase 7 once new terminology is fully rolled out
- Document that all legacy APIs are explicitly marked deprecated and scheduled for removal after the migration window

### Phase 2: Update Core Implementation ✅ COMPLETED
**Goal:** Migrate implementation to use new names internally

**Testing cadence:** Use quick checks (TypeScript build or targeted Jest paths) after each step, then run the full `npm test` suite after Step 2.3 and again after Step 2.8 to catch regressions without excessive repetition.

#### Step 2.1: Migrate Event → Moment (GraphEvent → TempMoment) ✅ COMPLETED
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

#### Step 2.2: Migrate Moment → Event (Moment class → Event class) ✅ COMPLETED
- Rename `Moment` class → `TempEventInternal` (temporary name)
- Update all internal references
- Keep `Moment` as deprecated alias pointing to `TempEventInternal`, marked with `@deprecated`
- **Files to modify:**
  - `src/resource.ts`
  - `src/extent.ts`
  - Update any internal method signatures
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.3: Final Event/Moment Swap ✅ COMPLETED
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

#### Step 2.4: Migrate Resource → Signal ✅ COMPLETED
- Rename `Resource` class → `Signal` in `src/resource.ts`
- Update all internal usage
- Keep `Resource` as deprecated alias clearly annotated and routed through a shared deprecation helper to log guidance in development builds
- **Files to modify:**
  - `src/resource.ts`
  - `src/behavior.ts`
  - `src/extent.ts`
  - `src/graph.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.5: Migrate Type-Specific Names ✅ COMPLETED
- Rename `State` → `StateSignal` in implementation
- Rename `Event` (former Moment) → `EventSignal` in implementation
- Keep old names as deprecated aliases annotated and routed through the same deprecation helper
- **Files to modify:**
  - `src/resource.ts`
  - Update extent factory methods
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.6: Migrate Demands → Dependencies ✅ COMPLETED
- Update behavior implementation to use `dependencies` internally
- Update `demands` to call `dependencies` for backward compatibility
- **Files to modify:**
  - `src/behavior.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.7: Migrate SideEffect → Effect ✅ COMPLETED
- Update behavior implementation to use `effect` internally
- Update `sideEffect` to call `effect` for backward compatibility
- **Files to modify:**
  - `src/behavior.ts`
  - `src/extent.ts` (if sideEffect defined there)
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2.8: Migrate Event Loop → Action Loop (Internal Implementation) ✅ COMPLETED
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

### Phase 2B: Final API Updates 🔄 TODO
**Goal:** Complete remaining API changes before test migration

**Important:** These changes should be done one at a time, with tests updated after each change to ensure they pass before proceeding to the next change.

#### Step 2B.1: Remove dependencies() method from BehaviorBuilder
- Remove `dependencies()` method from BehaviorBuilder, keeping only `dependsOn()`
- Update any internal usage to use `dependsOn()` instead
- Update tests to use `dependsOn()` instead of `dependencies()` where needed
- **Files to modify:**
  - `src/behavior.ts`
  - Any test files that use `dependencies()` on BehaviorBuilder
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2B.2: Rename ActionMoment → Moment
- Rename `ActionMoment` class to `Moment` (this was the final timestamp class)
- Update all internal usage from `ActionMoment` to `Moment`
- Keep `ActionMoment` as deprecated alias pointing to `Moment`
- Remove any conflicting aliases that prevent this change
- Update tests to use `Moment` instead of `ActionMoment`
- **Files to modify:**
  - `src/common.ts`
  - `src/graph.ts`
  - `src/resource.ts`
  - Test files using `ActionMoment`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2B.3: Remove sideEffect, keep only effect
- Remove `sideEffect()` method, keeping only `effect()`
- Update any remaining internal usage to use `effect()` instead
- Update tests to use `effect()` instead of `sideEffect()`
- **Files to modify:**
  - `src/behavior.ts`
  - `src/extent.ts`
  - Test files using `sideEffect()`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2B.4: Rename extent.moment → extent.event
- Update Extent class to have `.event()` method instead of `.moment()`
- Keep `.moment()` as deprecated alias pointing to `.event()`
- Update internal usage to prefer `.event()`
- Update tests to use `.event()` instead of `.moment()`
- **Files to modify:**
  - `src/extent.ts`
  - Test files using extent `.moment()` method
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2B.5: Update signal property names for moment/event consistency
- StateSignal: `traceMoment` → keep as is (StateSignal keeps traceMoment)
- EventSignal: `moment` → keep as is (EventSignal keeps moment)  
- Graph: `lastMoment` and `currentMoment` → keep as is
- This step verifies the naming is already consistent with the new API
- **Files to verify:**
  - `src/resource.ts`
  - `src/graph.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2B.6: Rename demandable → dependable
- Update any usage of "demandable" to "dependable" in APIs and internal logic
- Update related method names, properties, and type names
- Update tests to use "dependable" terminology
- **Files to modify:**
  - `src/behavior.ts`
  - `src/graph.ts`
  - `src/resource.ts`
  - Test files using "demandable" terminology
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2B.7: Finalize StateSignal → State and EventSignal → Event
- Update implementation so `State` is the primary class name (not `StateSignal`)
- Update implementation so `Event` is the primary class name (not `EventSignal`)
- Keep `StateSignal` and `EventSignal` as deprecated aliases
- Update tests to use `State` and `Event` instead of `StateSignal` and `EventSignal`
- **Files to modify:**
  - `src/resource.ts`
  - `src/extent.ts`
  - Test files using `StateSignal` and `EventSignal`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 2B.8: Update graph.ts internal logic with new terminology
- Update internal logic in `graph.ts` to use new terminology consistently
- Replace internal variable names, method names, and comments to use:
  - "signal" instead of "resource" 
  - "dependencies" instead of "demands" in internal logic
  - "moment" instead of "event" for timestamps
  - "action" instead of "event" for loop terminology
- This is separate from user-facing APIs - focuses on internal consistency
- Be careful and incremental - run tests frequently during this change
- **Files to modify:**
  - `src/graph.ts` (internal implementation only)
- **Test:** Run `npm test` after each group of changes to ensure functionality preserved

### Phase 3: Update Tests 🔄 TODO  
**Goal:** Migrate all tests to use new terminology

#### Step 3.1: Update Unit Tests - Core
- Update `src/__tests__/behavior-graph.test.ts`
  - Replace Resource → Signal
  - Replace EventSignal → Event (after Phase 2B.7)
  - Replace StateSignal → State (after Phase 2B.7)
  - Replace any remaining dependencies() → dependsOn() (after Phase 2B.1)
  - Replace demandable → dependable (after Phase 2B.6)
  - Replace ActionLoopState → ActionLoopState (already done)
  - Replace ActionLoopPhase → ActionLoopPhase (already done)
  - Replace helper usages (`lastEvent`, `currentEvent`, `traceEvent`, etc.) with their new moment terminology
  - Verify usage of extent.event() instead of extent.moment() (after Phase 2B.4)
- **Test:** Run `npm test` to ensure all tests pass

#### Step 3.2: Update Unit Tests - Signal Tests
- Update any signal-specific tests (formerly resource tests)
- Update event/state specific tests (formerly moment/state tests)
- Update to use new terminology from Phase 2B changes
- **Files to modify:**
  - `src/__tests__/vending.test.ts`
  - Any other test files with signal usage
- **Test:** Run `npm test` to ensure all tests pass

#### Step 3.3: Update Documentation Tests
- Update `src/__tests__/documentation.test.js`
- Update `src/__tests__/docs-code-example.test.js`
- **Test:** Run `npm test` to ensure all tests pass

### Phase 4: Update Documentation 🔄 TODO
**Goal:** Migrate all documentation to new terminology

#### Step 4.1: Update Core Documentation
- Update `BGforLLMs-Core.md`
  - Replace "resource" with "signal" throughout
  - Replace "moment resource" with "event" (after Phase 2B.7)
  - Replace "state resource" with "state" (after Phase 2B.7)
  - Replace "demands" with "dependsOn" (after Phase 2B.1)
  - Replace "demandable" with "dependable" (after Phase 2B.6)
  - Replace "event loop" with "action loop"
  - Replace "side effect" with "effect" (after Phase 2B.3)
  - Update the event/moment terminology carefully
  - Update extent.moment() → extent.event() (after Phase 2B.4)
- **Test:** Review for consistency and clarity

#### Step 4.2: Update JavaScript Documentation
- Update `BGforLLMs-JavaScript.md`
  - Apply same terminology changes as core docs
  - Update all code examples
  - Update API references
  - Replace ActionMoment → Moment (after Phase 2B.2)
  - Replace "event loop" → "action loop" in explanations
  - Update StateSignal → State and EventSignal → Event (after Phase 2B.7)
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

### Phase 5: Update Examples 🔄 TODO
**Goal:** Migrate all examples to use new terminology

#### Step 5.1: Update Browser Example
- Update `examples/browser/main.js`
- Update `examples/browser/app.js` 
- Update any HTML files with terminology
- Apply all Phase 2B terminology changes:
  - Resource → Signal
  - StateSignal → State, EventSignal → Event
  - dependencies() → dependsOn()
  - sideEffect() → effect()
  - extent.moment() → extent.event()
  - demandable → dependable
- **Files to modify:**
  - `examples/browser/main.js`
  - `examples/browser/app.js`
  - `examples/browser/public/hello.html`
- **Test:** Run browser example to ensure it works

#### Step 5.2: Update React App Example
- Update all files in `examples/reactapp/src/`
- Apply all Phase 2B terminology changes (same as Step 5.1)
- **Files to modify:**
  - `examples/reactapp/src/CounterExtent.js`
  - `examples/reactapp/src/AllCountersExtent.js`
  - Other React component files
- **Test:** Run react app example to ensure it works

#### Step 5.3: Update TodoMVC Examples
- Update `examples/todomvc/js/` files
- Update `examples/todomvc-react/js/` files
- Apply all Phase 2B terminology changes (same as Step 5.1)
- **Files to modify:**
  - `examples/todomvc/js/ListExtent.js`
  - `examples/todomvc/js/ItemExtent.js`
  - `examples/todomvc/js/ItemView.js`
  - `examples/todomvc/js/ListView.js`
  - Similar files in todomvc-react
- **Test:** Run TodoMVC examples to ensure they work

#### Step 5.4: Update Performance Tests
- Update `examples/perftests/src/index.ts`
- Apply all Phase 2B terminology changes (same as Step 5.1)
- **Test:** Run performance tests to ensure they work

### Phase 6: Update Exports and Public API 🔄 TODO
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

### Phase 7: Final Validation 🔄 TODO
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

## 🚀 GUIDANCE FOR NEXT AGENT (Phase 2B+)

### Phase 2B - API Updates Required:
**Do these changes ONE AT A TIME, updating tests after each:**
1. **Remove dependencies() from BehaviorBuilder** - keep only dependsOn()
2. **Rename ActionMoment → Moment** - update tests to use new name
3. **Remove sideEffect()** - keep only effect(), update tests
4. **Rename extent.moment() → extent.event()** - update tests
5. **Verify signal property names** - StateSignal.traceMoment, EventSignal.moment, Graph.lastMoment/currentMoment
6. **Rename demandable → dependable** - update tests
7. **Finalize StateSignal → State, EventSignal → Event** - update tests
8. **Update graph.ts internal logic** - use new terminology internally

### Phase 3+ - What You Can Safely Do:
1. **Update tests** to use new terminology (`Signal`, `Event`, `State`, `dependsOn()`, `effect()`)
2. **Update documentation** to use new names throughout
3. **Update examples** to demonstrate new API
4. **Reorder exports** to make new names primary in `src/index.ts`

### What to Be Careful About:
1. **Phase 2B changes must be incremental** - one step at a time with tests passing
2. **Keep all deprecated aliases** - they provide essential backward compatibility
3. **Update tests immediately** after each Phase 2B API change

### Quick Verification Commands:
```bash
npm test                    # Should always pass (156 tests)
npm run build              # Should build cleanly  
npm run test-coverage      # Should show good coverage
```

### Key Files Already Migrated:
- ✅ `src/common.ts` - ActionMoment class, GraphEvent alias
- ✅ `src/resource.ts` - Signal, EventSignal, StateSignal classes + aliases
- ✅ `src/behavior.ts` - BehaviorBuilder uses dependencies(), aliases added
- ✅ `src/extent.ts` - Uses new constructors, effect() alias
- ✅ `src/graph.ts` - ActionLoopState/Phase renamed
- ✅ `src/index.ts` - Exports both old and new names

### Files Ready for Phase 2B Updates:
- 🔄 **src/behavior.ts** - Remove dependencies(), keep dependsOn()
- 🔄 **src/common.ts** - Rename ActionMoment → Moment
- 🔄 **src/behavior.ts, src/extent.ts** - Remove sideEffect(), keep effect()
- 🔄 **src/extent.ts** - Rename moment() → event()
- 🔄 **All source files** - Rename demandable → dependable
- 🔄 **src/resource.ts** - Finalize State/Event as primary names
- 🔄 **src/graph.ts** - Update internal terminology
- 🔄 **Test files** - Update after each API change

After Phase 2B, remaining phases are mostly find-and-replace updates. 🎉
