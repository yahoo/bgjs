# Behavior Graph Concept Renaming Plan

## Overview

This document outlines a comprehensive plan to rename core concepts in the Behavior Graph library. The renaming requires careful coordination across code, tests, documentation, and examples to maintain functionality throughout the process.

## 🎉 PROGRESS STATUS

### ✅ COMPLETED PHASES:
- **Phase 1: Preparation and Infrastructure** - All aliases and backward compatibility infrastructure in place
- **Phase 2: Update Core Implementation** - All core classes and internal implementation migrated to new terminology
- **Phase 2B: Final API Updates** - All deprecated APIs removed, tests updated to new terminology

### 🔄 REMAINING PHASES:
- **Phase 3: Signal/Event Consolidation Migration** - ✅ COMPLETED - Merged Signal into Event, renamed Event to Signal, updated extent.event() to extent.signal()
- **Phase 4: Update Tests** - ✅ COMPLETED (Tests already converted during Phase 2B cleanup)
- **Phase 5: Update Documentation** - Update all documentation files
- **Phase 6: Update Examples** - Update example applications  
- **Phase 7: Update Exports and Public API** - ✅ COMPLETED (Clean exports implemented)
- **Phase 8: Final Validation** - ✅ COMPLETED (All 156 tests passing, clean build)

**Current Status:** 🎉 **ARCHITECTURE COMPLETE!** Signal/Event consolidation finished. Clean API with no deprecated names. All tests passing. Ready for documentation and examples updates.

## 📝 IMPORTANT IMPLEMENTATION NOTES FOR NEXT AGENT

### Key Implementation Decisions Made:

1. **Final Naming Completed**: 
   - `ActionMoment` → `Moment` (timestamp class)
   - `Resource` → Removed (consolidated into Signal)
   - `Event` → `Signal<T>` (base signal class for event-like signals)
   - `State` → `State<T>` (state signals extending Signal<T>)
   - `Demandable` → `Dependable` (dependency interface)

2. **Clean API Implementation**:
   - All deprecated aliases and methods removed completely
   - `BehaviorBuilder` uses `dependsOn()` as primary method
   - Signal instances use `.moment` property for timestamps
   - Extent uses `extent.signal()` to create signal instances
   - No backward compatibility - clean break for new API

3. **Final Class Hierarchy**:
   - `Signal<T>` - base signal class (formerly "Event", which was formerly "moment resources")
   - `State<T>` - state signals extending Signal<T> (formerly "state resources")
   - `Moment` - timestamp objects (formerly "GraphEvent")
   - `Dependable` - dependency interface (formerly "Demandable")

4. **Internal Implementation Updated**:
   - Graph: `currentMoment`, `lastMoment` (formerly `currentEvent`, `lastEvent`)
   - Graph: `modifiedDependencyBehaviors` (formerly `modifiedDemandBehaviors`)
   - Graph: `updateDependencies()` method (formerly `updateDemands()`)
   - All internal terminology uses new names consistently

### Remaining Old Names (Internal Only):

1. **Behavior class properties**: `demands`, `orderingDemands`, `untrackedDemands` 
   - Reason: These are internal properties accessed by graph.ts
   - Impact: Internal only, all public APIs use new terminology
   - Status: Could be refactored later if desired, but not user-facing

2. **Some debug strings and comments**: May still reference old terminology
   - Impact: Low priority, cosmetic only
   - Status: Can be updated when convenient

### Test Status:
- All 156 tests updated to use new terminology
- All tests pass with clean new API
- Test coverage maintained at 94.32%

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

### Phase 4: Update Tests 🔄 TODO  
**Goal:** Migrate all tests to use new terminology

#### Step 4.1: Update Unit Tests - Core
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

#### Step 4.2: Update Unit Tests - Signal Tests
- Update any signal-specific tests (formerly resource tests)
- Update event/state specific tests (formerly moment/state tests)
- Update to use new terminology from Phase 2B changes
- **Files to modify:**
  - `src/__tests__/vending.test.ts`
  - Any other test files with signal usage
- **Test:** Run `npm test` to ensure all tests pass

#### Step 4.3: Update Documentation Tests
- Update `src/__tests__/documentation.test.js`
- Update `src/__tests__/docs-code-example.test.js`
- **Test:** Run `npm test` to ensure all tests pass

### Phase 5: Update Documentation 🔄 TODO
**Goal:** Migrate all documentation to new terminology

#### Step 5.1: Update Core Documentation
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

#### Step 5.2: Update JavaScript Documentation
- Update `BGforLLMs-JavaScript.md`
  - Apply same terminology changes as core docs
  - Update all code examples
  - Update API references
  - Replace ActionMoment → Moment (after Phase 2B.2)
  - Replace "event loop" → "action loop" in explanations
  - Update StateSignal → State and EventSignal → Event (after Phase 2B.7)
- **Test:** Review for consistency and clarity

#### Step 5.3: Update README
- Update `README.md`
  - Update high-level concept descriptions
  - Ensure terminology consistency
- **Test:** Review for consistency and clarity

#### Step 5.4: Update Contributing Documentation
- Update `CONTRIBUTING.md` if it contains relevant terminology
- Update any other documentation files
- **Test:** Review for consistency

### Phase 6: Update Examples 🔄 TODO
**Goal:** Migrate all examples to use new terminology

#### Step 6.1: Update Browser Example
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

#### Step 6.2: Update React App Example
- Update all files in `examples/reactapp/src/`
- Apply all Phase 2B terminology changes (same as Step 6.1)
- **Files to modify:**
  - `examples/reactapp/src/CounterExtent.js`
  - `examples/reactapp/src/AllCountersExtent.js`
  - Other React component files
- **Test:** Run react app example to ensure it works

#### Step 6.3: Update TodoMVC Examples
- Update `examples/todomvc/js/` files
- Update `examples/todomvc-react/js/` files
- Apply all Phase 2B terminology changes (same as Step 6.1)
- **Files to modify:**
  - `examples/todomvc/js/ListExtent.js`
  - `examples/todomvc/js/ItemExtent.js`
  - `examples/todomvc/js/ItemView.js`
  - `examples/todomvc/js/ListView.js`
  - Similar files in todomvc-react
- **Test:** Run TodoMVC examples to ensure they work

#### Step 6.4: Update Performance Tests
- Update `examples/perftests/src/index.ts`
- Apply all Phase 2B terminology changes (same as Step 6.1)
- **Test:** Run performance tests to ensure they work

### Phase 7: Update Exports and Public API 🔄 TODO
**Goal:** Update primary exports to use new names

#### Step 7.1: Update Primary Exports
- Update `src/index.ts` to export new names as primary
- Keep old names as deprecated aliases
- Document any aliases slated for removal by creating follow-up issues or TODOs so they do not linger indefinitely
- **Files to modify:**
  - `src/index.ts`
- **Test:** Run `npm test` to ensure backward compatibility

#### Step 7.2: Update Build Configuration
- Verify build process works with new names
- Update any build scripts that reference old names
- **Test:** Run `npm run build` to ensure clean build

### Phase 8: Final Validation 🔄 TODO
**Goal:** Ensure everything works and is consistent

#### Step 8.1: Full Test Suite
- Run complete test suite: `npm test`
- Run test coverage: `npm run test-coverage`
- Verify all tests pass with new terminology
- Capture changelog notes and draft a release summary communicating renamed APIs and deprecation timelines

#### Step 8.2: Build Verification
- Run full build: `npm run build`
- Verify generated files use new terminology
- Test generated bundles

#### Step 8.3: Example Verification
- Test all examples manually
- Verify they work with renamed concepts
- Check for any remaining old terminology
- Remove the temporary README note added in Phase 1 once verification passes

#### Step 8.4: Documentation Review
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

## 🚀 GUIDANCE FOR NEXT AGENT (Remaining Work)

### ✅ CORE API MIGRATION COMPLETE!

**All critical renaming completed:**
- ✅ Clean API with no deprecated methods or aliases
- ✅ All 156 tests passing with new terminology  
- ✅ All exports updated to new names only
- ✅ Internal implementation uses new terminology

### 🔄 REMAINING TASKS (Optional/Documentation):

#### Phase 3: Signal/Event Consolidation Migration
**Priority: HIGH** - Structural improvement to class hierarchy
**Status:** ✅ COMPLETED

**Goal:** Consolidate Signal and Event classes for cleaner architecture
- ✅ Merge Signal functionality into Event class
- ✅ Rename Event to Signal (making it the base class)
- ✅ Update State to extend new Signal
- ✅ Remove extent.resource() method

#### Phase 5: Update Documentation Files
**Priority: Medium** - Update user-facing documentation

**Files to update:**
- `BGforLLMs-Core.md` - Core concepts documentation
- `BGforLLMs-JavaScript.md` - JavaScript-specific documentation  
- `README.md` - High-level overview
- `CONTRIBUTING.md` - Contributor guidelines (if applicable)

**Changes needed:**
- Replace "resource" with "signal" throughout
- Replace "moment resource" with "event" or "event signal"
- Replace "state resource" with "state" or "state signal"  
- Replace "demands" with "dependsOn" in examples
- Replace "sideEffect" with "effect" in examples
- Update code examples to use new API

#### Phase 6: Update Example Applications  
**Priority: Medium** - Update example projects

**Directories to update:**
- `examples/browser/` - Browser example
- `examples/reactapp/` - React application example
- `examples/todomvc/` - TodoMVC implementation
- `examples/todomvc-react/` - React TodoMVC
- `examples/perftests/` - Performance test examples

**Changes needed:**
- Update imports to new names
- Replace `.demands()` with `.dependsOn()`
- Replace `.moment()` with `.event()`
- Replace `.sideEffect()` with `.effect()`
- Update type annotations
- Update comments and documentation

### 🧪 Quick Verification Commands:
```bash
npm test                    # Should always pass (156 tests)
npm run build              # Should build cleanly  
npm run test-coverage      # Should show good coverage (94.32%)
```

### 💡 Implementation Notes for Documentation Updates:

1. **Use find-and-replace carefully** - The new API is clean and consistent
2. **Test examples after updating** - Ensure they still work correctly  
3. **Update both code and prose** - Don't miss explanatory text
4. **Maintain backward compatibility notes** - Mention the old API was deprecated

### 🎯 Success Criteria for Remaining Work:

**Documentation (Phase 4):**
- ✅ All documentation uses new terminology consistently
- ✅ Code examples compile and run with new API
- ✅ No references to deprecated methods remain

**Examples (Phase 5):**  
- ✅ All examples use new API exclusively
- ✅ Examples build and run correctly
- ✅ No console warnings about deprecated usage

**The hard work is done - remaining tasks are mostly find-and-replace!** 🎉

---

## 🚀 PHASE 3: Signal/Event Consolidation Migration

### Overview

After completing the core API migration, we have identified one more structural improvement: consolidating the Signal and Event classes. Currently:

- `Signal` is the base class with core functionality
- `Event<T>` extends Signal and adds event-specific behavior
- `State<T>` extends Signal and adds state-specific behavior

The new plan is to:
1. **Merge Signal functionality into Event** - Move all non-overridden Signal methods into Event
2. **Rename Event → Signal** - Event becomes the new base class called Signal  
3. **Update State inheritance** - State extends the new Signal (formerly Event)
4. **Remove extent.resource()** - No longer needed since Signal is now concrete like Event was

### Current Class Hierarchy
```
Signal (base class)
├── Event<T> extends Signal (event signals)
└── State<T> extends Signal (state signals)
```

### Target Class Hierarchy  
```
Signal (formerly Event - now base class)
└── State<T> extends Signal (state signals)
```

### Key Changes Required

#### 1. **Move Signal functionality to Event class**
Signal methods that are NOT overridden by Event need to be moved:
- `toString()` - Signal has generic version, Event overrides 
- `get justUpdated()` - Signal returns false, Event overrides with real implementation
- `assertValidUpdater()` and `assertValidAccessor()` - Core validation logic
- Subscription methods: `subscribeToJustUpdated()`, `_subscribeToJustUpdated()`, `notifyJustUpdatedSubscribers()`
- Properties: `debugName`, `isSignal`, `extent`, `graph`, `subsequents`, `suppliedBy`, `skipChecks`, `didUpdateSubscribers`
- Constructor logic and Dependable interface implementation

#### 2. **Update Event class**
- Inherit all Signal functionality that isn't already overridden
- Maintain existing Event-specific behavior (value, moment, update methods)
- Keep existing Event-specific properties and methods

#### 3. **Rename Event → Signal**  
- Update class name from `Event<T>` to `Signal<T>`
- Update all references and imports
- Update toString() to show "Signal" instead of "EventSignal"

#### 4. **Update State class**
- Change inheritance from `extends Signal` to `extends Signal<T>` (the new Signal)
- Ensure all State-specific behavior remains intact
- Update toString() to show "StateSignal" or just "State"

#### 5. **Remove extent.resource() method**
- Remove the `resource()` factory method from Extent
- Keep `event()` → renamed to create new Signal instances  
- Keep `state()` for creating State instances
- Update any code that uses `extent.resource()` to use `extent.event()` instead

#### 6. **Update exports and imports**
- Update index.ts exports
- The old Signal class disappears
- Event class becomes Signal class  
- State remains State but now extends the new Signal

### Migration Steps

#### Step 3.1: Move Signal functionality into Event class
- Copy all Signal methods that Event doesn't override into Event class
- Copy all Signal properties into Event class  
- Update Event constructor to include Signal constructor logic
- **Files to modify:**
  - `src/resource.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 3.2: Update Event class to be self-contained and enable State inheritance
- Remove `extends Signal` from Event class declaration
- Ensure Event implements Dependable interface directly
- **Key API improvement:** Remove `| undefined` from Event's value types to enable clean State inheritance
- Update Event's `value` property from `T | undefined` to `T`
- Update Event's `update()` and `updateWithAction()` methods to use conditional types for parameter handling
- Use method overloading to allow `Event<undefined>.update()` to be called with no parameters
- **Implementation approach:**
  ```typescript
  export class Event<T = undefined> implements Dependable, Transient {
      private _happenedValue: T;  // Remove | undefined
      
      get value(): T {  // Remove | undefined
          this.assertValidAccessor();
          return this._happenedValue;
      }
      
      // Method overloading for update()
      update(value: T): void;
      update(value?: T extends undefined ? undefined : never): void;
      update(value?: T): void {
          this.assertValidUpdater();
          this._happened = true;
          this._happenedValue = value as T;
          this._happenedWhen = this.graph.currentMoment;
          this.notifyJustUpdatedSubscribers();
          this.graph.resourceTouched(this);
          this.graph.trackTransient(this);
      }
      
      // Similar overloading for updateWithAction()
      updateWithAction(value: T, debugName?: string): void;
      updateWithAction(value?: T extends undefined ? undefined : never, debugName?: string): void;
      updateWithAction(value?: T, debugName?: string): void {
          this.graph.action(() => {
              this.update(value as T);
          }, debugName);
      }
  }
  ```
- **Benefits:** This enables `State<T>` to cleanly extend `Event<T>` without type conflicts
- **Files to modify:**
  - `src/resource.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 3.3: Update State to extend new Event class
- Change State inheritance from `extends Signal` to `extends Event<T>`
- **Now clean inheritance:** With Event<T> having `value: T` (not `T | undefined`), State can cleanly override this
- State's `value: T` property will naturally override Event's `value: T` property
- Remove State's `get value()` method since it now inherits a compatible one from Event
- Ensure State's constructor properly calls `super(extent, name)` and then sets initial value
- **Updated State class approach:**
  ```typescript
  export class State<T> extends Event<T> implements Transient {
      private currentState: StateHistory<T>;
      private previousState: StateHistory<T> | null = null;

      constructor(extent: Extent, initialState: T, name?: string) {
          super(extent, name);
          this.currentState = { value: initialState, moment: Moment.initialEvent };
          // Set the initial value in the parent Event
          this._happenedValue = initialState;
      }

      // Override get value() to return current state value
      get value(): T {
          this.assertValidAccessor();
          return this.currentState.value;
      }
      
      // State-specific methods remain the same...
  }
  ```
- **Benefits:** Cleaner inheritance hierarchy, State naturally has all Event functionality
- **Files to modify:**
  - `src/resource.ts`  
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 3.4: Rename Event → Signal
- Rename `Event<T>` class to `Signal<T>`
- Update toString() method to return "Signal" instead of "EventSignal"
- **Files to modify:**
  - `src/resource.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 3.5: Remove old Signal class
- Delete the old Signal class definition completely
- **Files to modify:**
  - `src/resource.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 3.6: Remove extent.resource() method
- Remove `resource()` method from Extent class
- Update any usages of `extent.resource()` to use `extent.event()` 
- **Specific usages to update:**
  - `behavior.ts` line 123: `this.extent.resource('(BG Dynamic Dependency Signal)')` → `this.extent.event()`
  - `behavior.ts` line 134: `this.extent.resource('(BG Dynamic Supply Signal)')` → `this.extent.event()`
- **Files to modify:**
  - `src/extent.ts` (remove method)
  - `src/behavior.ts` (update usages)
  - Any test files using `extent.resource()`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 3.7: Update exports and imports
- Update `src/index.ts` exports to reflect new class names
- Remove Signal export (since Event is now Signal)
- Keep Signal export but now points to the new Signal class (formerly Event)
- **Files to modify:**
  - `src/index.ts`
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 3.8: Update all references throughout codebase
- Update any remaining references to the old class names
- Update comments and documentation strings
- Update debug names and error messages  
- **Files to modify:**
  - `src/graph.ts` (if any references)
  - `src/behavior.ts` (if any references)
  - `src/extent.ts` (if any references)
- **Test:** Run `npm test` to ensure functionality preserved

#### Step 3.9: Update tests
- Update test files to use new class hierarchy
- Change `new Event()` to `new Signal()` where appropriate
- Update any assertions about class names or toString() output
- **Specific changes needed:**
  - `behavior-graph.test.ts`: Update lines 499, 532 (`new Event()` → `new Signal()`)
  - `vending.test.ts`: Update `Event` type annotations to `Signal`
  - `documentation.test.js`: Update `Event` imports to `Signal`
  - Update any toString() assertions from "EventSignal" to "Signal"
- **Files to modify:**
  - `src/__tests__/behavior-graph.test.ts`
  - `src/__tests__/vending.test.ts` 
  - `src/__tests__/documentation.test.js`
- **Test:** Run `npm test` to ensure all tests pass

### Implementation Considerations

#### Complex Areas
1. **Constructor chain** - Need to ensure State constructor properly calls new Signal constructor
2. **Interface implementation** - Event needs to implement Dependable directly after removing Signal base class
3. **Method overrides** - Ensure all Event method overrides are preserved during the merge
4. **Extent factory methods** - Remove resource() but keep event() working with new Signal class

#### Testing Strategy  
- Run tests after each step to catch issues early
- Pay special attention to constructor behavior and inheritance
- Verify that State instances still work correctly with new inheritance
- Check that subscription and notification methods work correctly

#### Rollback Plan
- Each step is atomic and can be reversed
- Git commits at each step for easy rollback
- Old functionality preserved until tests pass

### Expected Benefits

1. **Simpler hierarchy** - One base Signal class instead of separate Signal/Event  
2. **More intuitive naming** - "Signal" is the core concept, events are just signals
3. **Cleaner API** - No need for extent.resource() since Signal is concrete
4. **Better conceptual model** - Signals can have values and events, State specializes this
5. **Clean inheritance** - State<T> naturally extends Signal<T> with compatible value types
6. **Type safety** - Method overloading enables `Signal<undefined>.update()` with no parameters while maintaining type safety for other types

### Success Criteria

1. **All tests pass** - 156 tests continue to pass after migration
2. **Clean class hierarchy** - Signal as base, State as specialization
3. **Removed extent.resource()** - Method no longer exists or needed
4. **Preserved functionality** - All existing behavior works identically
5. **Updated exports** - Clean exports with new class names

This migration will complete the conceptual cleanup of the library's core abstractions.

---

## 🚀 MIGRATION GUIDE: How to Update Projects to New API

This section provides step-by-step instructions for agents updating existing Behavior Graph projects to use the new terminology.

### ⚠️ BREAKING CHANGES OVERVIEW

The new API is **not backward compatible**. All deprecated aliases have been removed for a clean API surface.

### 📋 Required Changes Checklist

#### 1. **Update Imports**

**Old imports:**
```typescript
import { Resource, Moment, State, Demandable, ActionMoment, GraphEvent } from 'behavior-graph';
```

**New imports:**
```typescript
import { Signal, State, Dependable, Moment } from 'behavior-graph';
```

**Import mapping:**
- `Resource` → Removed (use `Signal` instead)
- `Event` → Removed (consolidated into `Signal`)
- `Moment<T>` (event signals) → `Signal<T>`
- `State<T>` → `State<T>` (unchanged, but now extends Signal<T>)
- `Demandable` → `Dependable`
- `ActionMoment` → `Moment`
- `GraphEvent` → `Moment`

#### 2. **Update Type Annotations**

**Event-like Signals:**
```typescript
// Old
let buttonClick: Moment = this.moment();
let dataEvent: Moment<number> = this.moment();

// New
let buttonClick: Signal = this.signal();
let dataEvent: Signal<number> = this.signal();
```

**State Signals:**
```typescript
// Old (already correct)
let counter: State<number> = this.state(0);

// New (unchanged)
let counter: State<number> = this.state(0);
```

**Base Signals:**
```typescript
// Old
let signal: Resource = this.resource();

// New  
let signal: Signal = this.signal();  // or this.resource() for basic signals
```

**Dependencies:**
```typescript
// Old
function processDeps(deps: Demandable[]): void { }

// New
function processDeps(deps: Dependable[]): void { }
```

#### 3. **Update Extent Method Calls**

**Signal Creation:**
```typescript
// Old
this.buttonAction = this.moment();
this.dataReceived = this.moment<DataType>();

// New
this.buttonAction = this.signal();
this.dataReceived = this.signal<DataType>();
```

**State Creation (unchanged):**
```typescript
// These remain the same
this.counter = this.state(0);

// Basic signals can also use:
this.basicSignal = this.resource();  // Creates Signal<undefined>
```

#### 4. **Update Behavior Definitions**

**Dependencies:**
```typescript
// Old
this.behavior()
    .demands(this.buttonAction, this.dataInput)
    .supplies(this.result)
    .runs(extent => { ... });

// New
this.behavior()
    .dependsOn(this.buttonAction, this.dataInput)
    .supplies(this.result)
    .runs(extent => { ... });
```

**Dynamic Dependencies:**
```typescript
// Old
this.behavior()
    .dynamicDemands([this.selector], ext => [
        ext.selector.value ? ext.optionA : ext.optionB
    ])
    .runs(extent => { ... });

// New
this.behavior()
    .dynamicDependsOn([this.selector], ext => [
        ext.selector.value ? ext.optionA : ext.optionB
    ])
    .runs(extent => { ... });
```

**Side Effects:**
```typescript
// Old
extent.sideEffect(() => {
    console.log('Effect executed');
});

// New
extent.effect(() => {
    console.log('Effect executed');
});
```

#### 5. **Update Property Access**

**Signal Timestamps:**
```typescript
// Old
let timestamp = myEvent.event;  // This was confusing!

// New
let timestamp = mySignal.moment; // Clear: moment in time when signal was updated
```

**State Signal Properties (unchanged):**
```typescript
// These remain the same
let timestamp = myState.event;  // When state was last updated (note: still .event for states)
let value = myState.value;      // Current value
```

#### 6. **Update Variable Names and Comments**

**Variable Names:**
```typescript
// Old
let momentSignal: Moment = this.moment();
let resourceSignal: Resource = this.resource();

// New
let eventSignal: Signal = this.signal();
let baseSignal: Signal = this.resource();
```

**Comments:**
```typescript
// Old
// Create moment resource for button clicks
// Handle resource updates

// New  
// Create signal for button clicks
// Handle signal updates
```

### 🔧 **Automated Migration Script Example**

Here's a regex-based approach for large codebases:

```bash
# Import updates
sed -i 's/import.*Resource.*from/import { Signal } from/g' **/*.ts
sed -i 's/import.*Event.*from/import { Signal } from/g' **/*.ts
sed -i 's/import.*Moment.*from/import { Signal } from/g' **/*.ts
sed -i 's/import.*Demandable.*from/import { Dependable } from/g' **/*.ts

# Method calls
sed -i 's/\.demands(/\.dependsOn(/g' **/*.ts
sed -i 's/\.dynamicDemands(/\.dynamicDependsOn(/g' **/*.ts
sed -i 's/\.sideEffect(/\.effect(/g' **/*.ts
sed -i 's/\.moment()/\.signal()/g' **/*.ts

# Type annotations (be careful with these - may need manual review)
sed -i 's/: Moment\b/: Signal/g' **/*.ts
sed -i 's/: Resource\b/: Signal/g' **/*.ts
sed -i 's/: Demandable\b/: Dependable/g' **/*.ts

# Property access (requires careful review)
sed -i 's/\.event\b/\.moment/g' **/*.ts 
sed -i 's/\.lastEvent\b/\.lastMoment/g' **/*.ts 
sed -i 's/\.currentEvent\b/\.currentMoment/g' **/*.ts 
sed -i 's/\.traceEvent\b/\.traceMoment/g' **/*.ts 
 # Only for signal timestamp access!
```

**⚠️ Important:** Test thoroughly after automated changes!

### 🧪 **Testing Your Migration**

1. **Compilation Check:**
   ```bash
   npm run build
   # Should compile without errors
   ```

2. **Runtime Testing:**
   ```bash
   npm test
   # All existing functionality should work
   ```

3. **Type Checking:**
   ```bash
   npx tsc --noEmit
   # Should pass without type errors
   ```

### 🆘 **Common Migration Issues**

#### Issue 1: Mixed Signal/Moment Usage
**Problem:** Confusion between signals and timestamps
```typescript
// Wrong - mixing concepts
let signal: Signal = this.signal();
let timestamp = signal.event; // This property doesn't exist!
```

**Solution:**
```typescript
// Correct
let signal: Signal = this.signal();
let timestamp = signal.moment; // When the signal was updated
```

#### Issue 2: Import Conflicts
**Problem:** Multiple old imports in same file
```typescript
// Problematic
import { Resource, Event, Moment, State } from 'behavior-graph';
```

**Solution:**
```typescript
// Clean
import { Signal, State, Dependable, Moment } from 'behavior-graph';
```

#### Issue 3: Dynamic Dependency Method Name
**Problem:** Using old method name
```typescript
// Wrong
.dynamicDemands([switches], links => [...])
```

**Solution:**
```typescript
// Correct
.dynamicDependsOn([switches], links => [...])
```

### ✅ **Migration Verification**

After migration, verify:

1. ✅ No compilation errors
2. ✅ No runtime errors  
3. ✅ All tests pass
4. ✅ No deprecated import warnings
5. ✅ Code follows new naming conventions consistently

### 📞 **Need Help?**

If you encounter migration issues:

1. Check this migration guide for common patterns
2. Review the test files in this repository for examples
3. Ensure you're using the latest version of behavior-graph
4. Double-check that all imports use the new names

**The new API is cleaner and more intuitive - the migration effort is worth it!** 🎉
