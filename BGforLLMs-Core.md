# Behavior Graph Core Concepts for LLMs

## ⚠️ CRITICAL RULES - READ FIRST ⚠️

### Signal Ownership Rule (MOST IMPORTANT)
**Each signal can only be supplied by ONE behavior (or none, for action-only signals).**

This is the most fundamental constraint in Behavior Graph. Violating this will cause runtime errors.

❌ **WRONG - Multiple behaviors supplying same signal:**
```javascript
// This will ERROR at runtime
this.behavior().supplies(this.counter).runs(() => { /* updates counter */ });
this.behavior().supplies(this.counter).runs(() => { /* also tries to update counter */ });
```

✅ **CORRECT - Single behavior owns each signal:**
```javascript
// One behavior handles ALL counter updates
this.behavior()
  .dependsOn(this.increment, this.decrement, this.reset)
  .supplies(this.counter)
  .runs(() => {
    if (this.increment.justUpdated) this.counter.update(this.counter.value + 1);
    if (this.decrement.justUpdated) this.counter.update(this.counter.value - 1);  
    if (this.reset.justUpdated) this.counter.update(0);
  });
```

### Reading Supplied Signals
**If a behavior supplies a signal, it can read that signal's current value without depending on it.**

When a behavior supplies a signal, it has read access to the current value using `.value` within the same run block:

✅ **CORRECT - Read supplied signal without depending on it:**
```javascript
this.behavior()
  .dependsOn(this.addItem)
  .supplies(this.items)  // We supply this signal
  .runs(() => {
    if (this.addItem.justUpdated) {
      const currentItems = this.items.value;  // ✅ Can read without depending on it
      this.items.update([...currentItems, this.addItem.value]);
    }
  });
```

❌ **UNNECESSARY - Don't depend on signals you supply:**
```javascript
this.behavior()
  .dependsOn(this.addItem, this.items)  // ❌ Unnecessary to depend on items
  .supplies(this.items)
  .runs(() => {
    // Same logic as above
  });
```

**Benefits:**
- Reduces dependency complexity
- Prevents potential circular dependencies  
- Keeps behavior declarations cleaner
- Common pattern for accumulator operations (arrays, counters, etc.)

### Actions Required for External Updates
**All signal updates outside of behavior run blocks must be wrapped in actions.**

❌ **WRONG - Direct updates in event handlers:**
```javascript
button.addEventListener('click', () => {
  app.counter.update(5); // ERROR: Update outside behavior/action
});
```

✅ **CORRECT - Wrap in action:**
```javascript
button.addEventListener('click', () => {
  app.graph.action(() => {
    app.counter.update(5); // ✅ Safe inside action
  });
});
```

### Effects for Async Operations
**Use effects for async operations that will later update signals.**

❌ **WRONG - Async update in behavior:**
```javascript
this.behavior()
  .dependsOn(this.loadData)
  .supplies(this.data)
  .runs(() => {
    if (this.loadData.justUpdated) {
      // DON'T: This update happens after behavior completes
      fetch('/api/data').then(response => {
        this.data.update(response); // ERROR: Outside behavior context
      });
    }
  });
```

✅ **CORRECT - Effect + action pattern:**
```javascript
this.behavior()
  .dependsOn(this.loadData)
  .supplies(this.data)
  .runs(() => {
    if (this.loadData.justUpdated) {
      // DO: Use effect for async operation
      this.effect(async () => {
        const response = await fetch('/api/data');
        const data = await response.json();
        
        // Update via action when async operation completes
        this.graph.action(() => {
          this.data.update(data);
        });
      });
    }
  });
```

### Supplied Signals Cannot Be Updated in Actions
**If a signal is supplied by a behavior, only that behavior can update it - not actions.**

❌ **WRONG - Action updating supplied signal:**
```javascript
// Behavior supplies the signal
this.behavior().supplies(this.data).runs(() => { /* behavior logic */ });

// Later in async method - ERROR!
this.graph.action(() => {
  this.data.update(newValue); // ERROR: data is supplied by behavior
});
```

✅ **CORRECT - Use event signal pattern:**
```javascript
// Create event signal for async results
this.dataLoaded = this.signal();

// Behavior responds to both trigger and result signals
this.behavior()
  .dependsOn(this.loadData, this.dataLoaded)
  .supplies(this.data)
  .runs(() => {
    if (this.loadData.justUpdated) {
      this.effect(() => { this.fetchData(); });
    }
    if (this.dataLoaded.justUpdated) {
      this.data.update(this.dataLoaded.value); // ✅ Behavior can update its own signal
    }
  });

// Async method updates signal, not supplied signal
async fetchData() {
  const response = await fetch('/api/data');
  const data = await response.json();
  this.graph.action(() => {
    this.dataLoaded.update(data); // ✅ Signal can be updated in action
  });
}
```

### DOM Updates Must Be Effects
**All external system interactions (DOM, console, file I/O) must be effects, not direct in behavior run blocks.**

❌ **WRONG - Direct DOM manipulation in behavior:**
```javascript
this.behavior()
  .dependsOn(this.counter)
  .runs(() => {
    // DON'T: Direct DOM update in behavior run block
    document.getElementById('count').textContent = this.counter.value;
  });
```

✅ **CORRECT - DOM updates in effects:**
```javascript
this.behavior()
  .dependsOn(this.counter)
  .runs(() => {
    // DO: Wrap DOM updates in effects
    this.effect(() => {
      document.getElementById('count').textContent = this.counter.value;
    });
  });
```

### Other Critical Rules
- **No circular dependencies** - If A depends on B, B cannot depend on A
- **Actions can only update signals NOT supplied by behaviors**
- **Must declare ALL signal accesses in dependsOn/supplies**

### Quick Architecture Checklist
Before writing Behavior Graph code, ask:
1. **"Which behavior owns each signal?"** - Design ownership first
2. **"Are there any cycles?"** - Trace dependency paths
3. **"What events trigger updates?"** - Identify all input events
4. **"What effects are needed?"** - Plan external interactions
5. **"Are any updates happening outside behaviors?"** - Must use actions or effects
6. **"Are DOM/console/file operations in effects?"** - Never direct in run blocks

---

## What is Behavior Graph

Behavior Graph is a reactive programming architecture that replaces traditional function-based control flow with automatic dependency management. Instead of manually sequencing function calls, you declare dependency relationships and let the runtime handle execution order.

**Core Problem Solved:** Event-driven applications with shared mutable state become complex due to implicit dependency graphs between code portions. Behavior Graph makes these dependencies explicit and automates control flow.

**Key Insight:** Like spreadsheet formulas that automatically recalculate when dependencies change, Behavior Graph behaviors automatically run when their dependent resources update.

## Fundamental Concepts

### Signals (Data Containers)
Signals are reactive containers that hold data and track when it changes.

**Two Types:**

1. **State Signals:** Persistent data that changes over time
   - Always contain data (cannot be null/undefined)
   - Persist between events
   - Example: user profile, current score, configuration settings

2. **Event Signals:** Events that happen at specific moments
   - May contain data payload or be empty
   - Do not persist (reset after each event)
   - Example: button clicks, network responses, timer events

**Key Properties:**
- `.value` - Current contents
- `.justUpdated` - True if updated in current event
- `.moment` - Reference to current moment with timestamp
- `.trace` - Value from beginning of current event (before updates)

### Behaviors (Reactive Code Blocks)
Behaviors are units of logic that respond to signal changes.

**Three Parts:**
1. **Dependencies:** Signals the behavior reads from (input dependencies)
2. **Supplies:** Signals the behavior writes to (outputs)
3. **Runs:** Imperative code block that executes

**Key Rules:**
- Never called directly - only triggered by signal updates
- Must declare all dependencies explicitly
- Run in topologically sorted order (dependency graph)
- Can only update signals they supply
- Can access `.value` of dependent or supplied signals

### Extents (Lifecycle Containers)
Extents are classes that group related behaviors and signals with shared lifetimes.

**Purpose:**
- Organize components logically (like classes in OOP)
- Manage creation/destruction of related elements
- Provide factory methods for signals and behaviors
- Handle dynamic graph modifications

**Built-in Signals:**
- `addedToGraph` - Signal that fires when extent is added
- Useful for initialization effects

### Graph (Central Orchestrator)
The Graph manages the entire reactive system.

**Responsibilities:**
- Execute actions and cascade updates
- Detect and prevent dependency cycles
- Schedule behaviors in correct order
- Manage side effects

### Actions (External Input)
Actions are the only way to introduce information from outside the system.

**Characteristics:**
- Started with `graph.action(() => { ... })`
- Can update signals not supplied by behaviors
- Trigger cascading behavior execution
- Atomic - all updates treated as simultaneous

### Effects (External Output)
Effects interact with external systems (UI, network, files).

**Key Properties:**
- Created inside behaviors with `this.effect(() => { ... })`
- Deferred until all behaviors complete
- Ensure consistent state access
- Run in creation order

## The Action Loop

Each action triggers a "moment" - a complete pass through the dependency graph:

1. **Action starts** - External code updates signals
2. **Behaviors activate** - Runtime identifies dependent behaviors
3. **Behaviors run** - Execute in topological order
4. **Effects queue** - Behaviors can create deferred operations
5. **Effects execute** - Run in order after all behaviors complete
6. **Moment ends** - All signals marked as no longer "just updated"

## Core Programming Patterns

### Basic Signal Creation
```
// State signal with initial value
this.counter = this.state(0);

// Event signal (no initial value)
this.buttonClick = this.signal();
```

### Basic Behavior Structure
```
this.behavior()
    .dependsOn(this.inputSignal1, this.inputSignal2)
    .supplies(this.outputSignal)
    .runs(() => {
        // Imperative code here
        if (this.inputSignal1.justUpdated) {
            this.outputSignal.update(this.inputSignal1.value + 1);
        }
    });
```

### Checking What Changed
```
.runs(() => {
    if (this.signal1.justUpdated) {
        // React to signal1 changing
    }
    if (this.signal2.justUpdated) {
        // React to signal2 changing
    }
    // Always access current values with .value
    let current = this.signal1.value;
})
```

### Using Trace Values
```
.runs(() => {
    let oldValue = this.counter.trace;  // Value before this event
    let newValue = this.counter.value;  // Current value
    let delta = newValue - oldValue;
})
```

## Advanced Concepts

### Dynamic Dependencies
Behaviors can have dependencies that change at runtime:

```
.dynamicDependsOn([this.itemList], () => {
    return this.itemList.value.map(item => item.status);
})
```

### Order-Only Dependencies
Access signal values without triggering on their updates:

```
.dependsOn(this.triggerSignal, this.configSignal.order)
```

The behavior only runs when `triggerSignal` updates, but can still read `configSignal.value`.

### Extent Hierarchies
Extents can contain child extents with managed lifetimes:

```
let childExtent = new ChildExtent(this.graph);
this.addChildLifetime(childExtent);
childExtent.addToGraph();
```

## Critical Rules

### Dependency Graph Must Be Acyclic (DAG)
The graph cannot have cycles. If behavior A depends on signal X, and behavior B (which supplies X) depends on signal Y, then behavior C (which supplies Y) cannot depend on signals supplied by behavior A.

**Solutions for Cycles:**
1. **Lift dependencies** - Create new behavior higher in graph
2. **Use trace values** - Access previous values without creating dependency
3. **Move to effects** - Update signals in deferred effects

### Signal Ownership
- Each signal can only be supplied by ONE behavior (or none)
- Actions can only update signals not supplied by behaviors
- Behaviors can only update signals they supply
- Multiple behaviors can depend on the same signal

### Explicit Dependencies
- Must declare all signal accesses in dependsOn/supplies
- Runtime will error if you access undeclared signals
- This explicitness aids debugging and understanding

## Common Anti-Patterns

### ❌ Multiple Behaviors Supplying Same Signal (RUNTIME ERROR)
```javascript
// DON'T: This will cause "Signal cannot be supplied by more than one behavior" error
class BadExtent extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.projects = this.state([]);
    this.loadProjects = this.signal();
    this.createProject = this.signal();
    
    // WRONG: Two behaviors both supply projects
    this.behavior()
      .dependsOn(this.loadProjects)
      .supplies(this.projects)  // ❌ First supplier
      .runs(() => { /* load logic */ });
      
    this.behavior()
      .dependsOn(this.createProject)  
      .supplies(this.projects)  // ❌ Second supplier - ERROR!
      .runs(() => { /* create logic */ });
  }
}

// DO: Consolidate into single behavior
class GoodExtent extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.projects = this.state([]);
    this.loadProjects = this.signal();
    this.createProject = this.signal();
    
    // CORRECT: One behavior handles all projects updates
    this.behavior()
      .dependsOn(this.loadProjects, this.createProject)
      .supplies(this.projects)  // ✅ Single supplier
      .runs(() => {
        if (this.loadProjects.justUpdated) { /* load logic */ }
        if (this.createProject.justUpdated) { /* create logic */ }
      });
  }
}
```

### ❌ Hidden Dependencies
```
.dependsOn(this.input)
.runs(() => {
    // DON'T: accessing undeclared signal
    if (this.hiddenSignal.value > 0) { ... }
})
```

### ❌ Updating Non-Supplied Signals
```
.supplies(this.output)
.runs(() => {
    // DON'T: updating signal not in supplies
    this.someOtherSignal.update(value);
})
```

### ❌ Effects in Main Logic
```
.runs(() => {
    // DON'T: direct UI updates in behaviors
    document.getElementById("button").disabled = false;
    
    // DO: use effects
    this.effect(() => {
        document.getElementById("button").disabled = false;
    });
})
```

### ❌ Using Actions to Bypass Single Supplier Rule
**This is a common antipattern - using `graph.action()` to update state signals from multiple behaviors.**

```javascript
// DON'T: Violating single supplier principle with actions
class BadExtent extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.counter = this.state(0);
    this.increment = this.signal();
    this.reset = this.signal();
    
    // WRONG: This behavior supplies counter
    this.behavior()
      .dependsOn(this.increment)
      .supplies(this.counter)
      .runs(() => {
        if (this.increment.justUpdated) {
          this.counter.update(this.counter.value + 1);
        }
      });
      
    // WRONG: Another behavior also tries to update counter using action hack
    this.behavior()
      .dependsOn(this.reset)
      .supplies(this.someOtherState)
      .runs(() => {
        this.effect(() => {
          // Antipattern: Using action to bypass single supplier rule
          this.graph.action(() => {
            this.counter.update(0);  // ❌ Multiple behaviors updating same signal
          });
        });
      });
  }
}

// DO: Use event signals for events, single behavior for state
class GoodExtent extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.counter = this.state(0);
    this.incrementRequested = this.signal();
    this.resetRequested = this.signal();
    
    // CORRECT: Single behavior supplies counter, reacts to all events
    this.behavior()
      .dependsOn(this.incrementRequested, this.resetRequested)
      .supplies(this.counter)
      .runs(() => {
        if (this.incrementRequested.justUpdated) {
          this.counter.update(this.counter.value + 1);
        }
        if (this.resetRequested.justUpdated) {
          this.counter.update(0);
        }
      });
  }
  
  // Methods emit events via signals instead of direct updates
  increment() {
    this.graph.action(() => {
      this.incrementRequested.update({});
    });
  }
  
  reset() {
    this.graph.action(() => {
      this.resetRequested.update({});
    });
  }
}
```

**Why this antipattern is harmful:**
- Makes state changes unpredictable and hard to debug
- Breaks Behavior Graph's core principle of single signal ownership
- `graph.action()` is intended for external events, not internal state coordination
- Leads to scattered state update logic instead of centralized control

**Key principle: Use event signals to communicate events between behaviors, not actions to bypass the single supplier rule.**

## Debugging Dependency Cycles

When you get a cycle error:

1. **Identify the cycle** - Look at the error message for involved behaviors/resources
2. **Draw the dependency graph** - Visualize the problematic relationships
3. **Find the breaking point** - Look for where to lift logic or use trace values
4. **Refactor** - Apply one of the cycle-breaking solutions

## Testing Strategies

### Unit Testing Behaviors
- Create minimal extent with just the behavior under test
- Update dependent signals via actions
- Assert on supplied signal values
- Test both positive and negative cases

### Integration Testing
- Test complete extent interactions
- Verify effects occur correctly
- Test dynamic dependency updates
- Verify lifecycle management

## When to Use Behavior Graph

**Good Fits:**
- Event-driven applications (UI, games, control systems)
- Complex state management with many interdependencies
- Real-time applications with cascading updates
- Systems where order of operations matters

**Poor Fits:**
- Simple linear workflows
- Pure computational tasks without state
- High-performance critical sections (nanosecond requirements)
- Systems with minimal interdependencies

## Integration with Existing Code

Behavior Graph is designed for incremental adoption:

1. **Start small** - Convert one component at a time
2. **Bridge with actions** - External code can trigger actions
3. **Bridge with effects** - Behaviors can call existing APIs
4. **Coexist** - Behavior Graph and traditional code can work together

## Performance Considerations

- Behavior Graph adds overhead for dependency tracking
- Excellent for typical application performance requirements
- Avoid for nanosecond-critical code paths
- Dynamic dependencies have additional cost
- Effect deferral prevents some immediate operations

This foundation applies universally across all Behavior Graph platforms. Platform-specific syntax and patterns are covered in the platform-specific guides.
