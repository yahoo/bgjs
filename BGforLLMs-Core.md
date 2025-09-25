# Behavior Graph Core Concepts for LLMs

## ⚠️ CRITICAL RULES - READ FIRST ⚠️

### Resource Ownership Rule (MOST IMPORTANT)
**Each resource can only be supplied by ONE behavior (or none, for action-only resources).**

This is the most fundamental constraint in Behavior Graph. Violating this will cause runtime errors.

❌ **WRONG - Multiple behaviors supplying same resource:**
```javascript
// This will ERROR at runtime
this.behavior().supplies(this.counter).runs(() => { /* updates counter */ });
this.behavior().supplies(this.counter).runs(() => { /* also tries to update counter */ });
```

✅ **CORRECT - Single behavior owns each resource:**
```javascript
// One behavior handles ALL counter updates
this.behavior()
  .demands(this.increment, this.decrement, this.reset)
  .supplies(this.counter)
  .runs(() => {
    if (this.increment.justUpdated) this.counter.update(this.counter.value + 1);
    if (this.decrement.justUpdated) this.counter.update(this.counter.value - 1);  
    if (this.reset.justUpdated) this.counter.update(0);
  });
```

### Reading Supplied Resources
**If a behavior supplies a resource, it can read that resource's current value without demanding it.**

When a behavior supplies a resource, it has read access to the current value using `.value` within the same run block:

✅ **CORRECT - Read supplied resource without demanding:**
```javascript
this.behavior()
  .demands(this.addItem)
  .supplies(this.items)  // We supply this resource
  .runs(() => {
    if (this.addItem.justUpdated) {
      const currentItems = this.items.value;  // ✅ Can read without demanding
      this.items.update([...currentItems, this.addItem.value]);
    }
  });
```

❌ **UNNECESSARY - Don't demand resources you supply:**
```javascript
this.behavior()
  .demands(this.addItem, this.items)  // ❌ Unnecessary to demand items
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
**All resource updates outside of behavior run blocks must be wrapped in actions.**

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

### Side Effects for Async Operations
**Use side effects for async operations that will later update resources.**

❌ **WRONG - Async update in behavior:**
```javascript
this.behavior()
  .demands(this.loadData)
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

✅ **CORRECT - Side effect + action pattern:**
```javascript
this.behavior()
  .demands(this.loadData)
  .supplies(this.data)
  .runs(() => {
    if (this.loadData.justUpdated) {
      // DO: Use side effect for async operation
      this.sideEffect(async () => {
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

### Supplied Resources Cannot Be Updated in Actions
**If a resource is supplied by a behavior, only that behavior can update it - not actions.**

❌ **WRONG - Action updating supplied resource:**
```javascript
// Behavior supplies the resource
this.behavior().supplies(this.data).runs(() => { /* behavior logic */ });

// Later in async method - ERROR!
this.graph.action(() => {
  this.data.update(newValue); // ERROR: data is supplied by behavior
});
```

✅ **CORRECT - Use moment resource pattern:**
```javascript
// Create moment for async results
this.dataLoaded = this.moment();

// Behavior responds to both trigger and result moments
this.behavior()
  .demands(this.loadData, this.dataLoaded)
  .supplies(this.data)
  .runs(() => {
    if (this.loadData.justUpdated) {
      this.sideEffect(() => { this.fetchData(); });
    }
    if (this.dataLoaded.justUpdated) {
      this.data.update(this.dataLoaded.value); // ✅ Behavior can update its own resource
    }
  });

// Async method updates moment, not supplied resource
async fetchData() {
  const response = await fetch('/api/data');
  const data = await response.json();
  this.graph.action(() => {
    this.dataLoaded.update(data); // ✅ Moment can be updated in action
  });
}
```

### DOM Updates Must Be Side Effects
**All external system interactions (DOM, console, file I/O) must be side effects, not direct in behavior run blocks.**

❌ **WRONG - Direct DOM manipulation in behavior:**
```javascript
this.behavior()
  .demands(this.counter)
  .runs(() => {
    // DON'T: Direct DOM update in behavior run block
    document.getElementById('count').textContent = this.counter.value;
  });
```

✅ **CORRECT - DOM updates in side effects:**
```javascript
this.behavior()
  .demands(this.counter)
  .runs(() => {
    // DO: Wrap DOM updates in side effects
    this.sideEffect(() => {
      document.getElementById('count').textContent = this.counter.value;
    });
  });
```

### Other Critical Rules
- **No circular dependencies** - If A depends on B, B cannot depend on A
- **Actions can only update resources NOT supplied by behaviors**
- **Must declare ALL resource accesses in demands/supplies**

### Quick Architecture Checklist
Before writing Behavior Graph code, ask:
1. **"Which behavior owns each resource?"** - Design ownership first
2. **"Are there any cycles?"** - Trace dependency paths
3. **"What moments trigger updates?"** - Identify all input events
4. **"What side effects are needed?"** - Plan external interactions
5. **"Are any updates happening outside behaviors?"** - Must use actions or side effects
6. **"Are DOM/console/file operations in side effects?"** - Never direct in run blocks

---

## What is Behavior Graph

Behavior Graph is a reactive programming architecture that replaces traditional function-based control flow with automatic dependency management. Instead of manually sequencing function calls, you declare dependency relationships and let the runtime handle execution order.

**Core Problem Solved:** Event-driven applications with shared mutable state become complex due to implicit dependency graphs between code portions. Behavior Graph makes these dependencies explicit and automates control flow.

**Key Insight:** Like spreadsheet formulas that automatically recalculate when dependencies change, Behavior Graph behaviors automatically run when their dependent resources update.

## Fundamental Concepts

### Resources (Data Containers)
Resources are reactive containers that hold data and track when it changes.

**Two Types:**

1. **State Resources:** Persistent data that changes over time
   - Always contain data (cannot be null/undefined)
   - Persist between events
   - Example: user profile, current score, configuration settings

2. **Moment Resources:** Events that happen at specific moments
   - May contain data payload or be empty
   - Do not persist (reset after each event)
   - Example: button clicks, network responses, timer events

**Key Properties:**
- `.value` - Current contents (State only)
- `.justUpdated` - True if updated in current event
- `.event` - Reference to current event with timestamp
- `.trace` - Value from beginning of current event (before updates)

### Behaviors (Reactive Code Blocks)
Behaviors are units of logic that respond to resource changes.

**Three Parts:**
1. **Demands:** Resources the behavior reads from (input dependencies)
2. **Supplies:** Resources the behavior writes to (outputs)
3. **Runs:** Imperative code block that executes

**Key Rules:**
- Never called directly - only triggered by resource updates
- Must declare all dependencies explicitly
- Run in topologically sorted order (dependency graph)
- Can only update resources they supply
- Can access `.value` of demanded or supplied resources

### Extents (Lifecycle Containers)
Extents are classes that group related behaviors and resources with shared lifetimes.

**Purpose:**
- Organize components logically (like classes in OOP)
- Manage creation/destruction of related elements
- Provide factory methods for resources and behaviors
- Handle dynamic graph modifications

**Built-in Resources:**
- `addedToGraph` - Moment that fires when extent is added
- Useful for initialization side effects

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
- Can update resources not supplied by behaviors
- Trigger cascading behavior execution
- Atomic - all updates treated as simultaneous

### Side Effects (External Output)
Side effects interact with external systems (UI, network, files).

**Key Properties:**
- Created inside behaviors with `this.sideEffect(() => { ... })`
- Deferred until all behaviors complete
- Ensure consistent state access
- Run in creation order

## The Event Loop

Each action triggers an "event" - a complete pass through the dependency graph:

1. **Action starts** - External code updates resources
2. **Behaviors activate** - Runtime identifies dependent behaviors
3. **Behaviors run** - Execute in topological order
4. **Side effects queue** - Behaviors can create deferred operations
5. **Side effects execute** - Run in order after all behaviors complete
6. **Event ends** - All resources marked as no longer "just updated"

## Core Programming Patterns

### Basic Resource Creation
```
// State resource with initial value
this.counter = this.state(0);

// Moment resource (no initial value)
this.buttonClick = this.moment();
```

### Basic Behavior Structure
```
this.behavior()
    .demands(this.inputResource1, this.inputResource2)
    .supplies(this.outputResource)
    .runs(() => {
        // Imperative code here
        if (this.inputResource1.justUpdated) {
            this.outputResource.update(this.inputResource1.value + 1);
        }
    });
```

### Checking What Changed
```
.runs(() => {
    if (this.resource1.justUpdated) {
        // React to resource1 changing
    }
    if (this.resource2.justUpdated) {
        // React to resource2 changing
    }
    // Always access current values with .value
    let current = this.resource1.value;
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
.dynamicDemands([this.itemList], () => {
    return this.itemList.value.map(item => item.status);
})
```

### Order-Only Dependencies
Access resource values without triggering on their updates:

```
.demands(this.triggerResource, this.configResource.order)
```

The behavior only runs when `triggerResource` updates, but can still read `configResource.value`.

### Extent Hierarchies
Extents can contain child extents with managed lifetimes:

```
let childExtent = new ChildExtent(this.graph);
this.addChildLifetime(childExtent);
childExtent.addToGraph();
```

## Critical Rules

### Dependency Graph Must Be Acyclic (DAG)
The graph cannot have cycles. If behavior A depends on resource X, and behavior B (which supplies X) depends on resource Y, then behavior C (which supplies Y) cannot depend on resources supplied by behavior A.

**Solutions for Cycles:**
1. **Lift dependencies** - Create new behavior higher in graph
2. **Use trace values** - Access previous values without creating dependency
3. **Move to side effects** - Update resources in deferred side effects

### Resource Ownership
- Each resource can only be supplied by ONE behavior (or none)
- Actions can only update resources not supplied by behaviors
- Behaviors can only update resources they supply
- Multiple behaviors can demand the same resource

### Explicit Dependencies
- Must declare all resource accesses in demands/supplies
- Runtime will error if you access undeclared resources
- This explicitness aids debugging and understanding

## Common Anti-Patterns

### ❌ Multiple Behaviors Supplying Same Resource (RUNTIME ERROR)
```javascript
// DON'T: This will cause "Resource cannot be supplied by more than one behavior" error
class BadExtent extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.projects = this.state([]);
    this.loadProjects = this.moment();
    this.createProject = this.moment();
    
    // WRONG: Two behaviors both supply projects
    this.behavior()
      .demands(this.loadProjects)
      .supplies(this.projects)  // ❌ First supplier
      .runs(() => { /* load logic */ });
      
    this.behavior()
      .demands(this.createProject)  
      .supplies(this.projects)  // ❌ Second supplier - ERROR!
      .runs(() => { /* create logic */ });
  }
}

// DO: Consolidate into single behavior
class GoodExtent extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.projects = this.state([]);
    this.loadProjects = this.moment();
    this.createProject = this.moment();
    
    // CORRECT: One behavior handles all projects updates
    this.behavior()
      .demands(this.loadProjects, this.createProject)
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
.demands(this.input)
.runs(() => {
    // DON'T: accessing undeclared resource
    if (this.hiddenResource.value > 0) { ... }
})
```

### ❌ Updating Non-Supplied Resources
```
.supplies(this.output)
.runs(() => {
    // DON'T: updating resource not in supplies
    this.someOtherResource.update(value);
})
```

### ❌ Side Effects in Main Logic
```
.runs(() => {
    // DON'T: direct UI updates in behaviors
    document.getElementById("button").disabled = false;
    
    // DO: use side effects
    this.sideEffect(() => {
        document.getElementById("button").disabled = false;
    });
})
```

### ❌ Using Actions to Bypass Single Supplier Rule
**This is a common antipattern - using `graph.action()` to update state resources from multiple behaviors.**

```javascript
// DON'T: Violating single supplier principle with actions
class BadExtent extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.counter = this.state(0);
    this.increment = this.moment();
    this.reset = this.moment();
    
    // WRONG: This behavior supplies counter
    this.behavior()
      .demands(this.increment)
      .supplies(this.counter)
      .runs(() => {
        if (this.increment.justUpdated) {
          this.counter.update(this.counter.value + 1);
        }
      });
      
    // WRONG: Another behavior also tries to update counter using action hack
    this.behavior()
      .demands(this.reset)
      .supplies(this.someOtherState)
      .runs(() => {
        this.sideEffect(() => {
          // Antipattern: Using action to bypass single supplier rule
          this.graph.action(() => {
            this.counter.update(0);  // ❌ Multiple behaviors updating same resource
          });
        });
      });
  }
}

// DO: Use moments for events, single behavior for state
class GoodExtent extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.counter = this.state(0);
    this.incrementRequested = this.moment();
    this.resetRequested = this.moment();
    
    // CORRECT: Single behavior supplies counter, reacts to all events
    this.behavior()
      .demands(this.incrementRequested, this.resetRequested)
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
  
  // Methods emit events via moments instead of direct updates
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
- Breaks Behavior Graph's core principle of single resource ownership
- `graph.action()` is intended for external events, not internal state coordination
- Leads to scattered state update logic instead of centralized control

**Key principle: Use moments to communicate events between behaviors, not actions to bypass the single supplier rule.**

## Debugging Dependency Cycles

When you get a cycle error:

1. **Identify the cycle** - Look at the error message for involved behaviors/resources
2. **Draw the dependency graph** - Visualize the problematic relationships
3. **Find the breaking point** - Look for where to lift logic or use trace values
4. **Refactor** - Apply one of the cycle-breaking solutions

## Testing Strategies

### Unit Testing Behaviors
- Create minimal extent with just the behavior under test
- Update demanded resources via actions
- Assert on supplied resource values
- Test both positive and negative cases

### Integration Testing
- Test complete extent interactions
- Verify side effects occur correctly
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
3. **Bridge with side effects** - Behaviors can call existing APIs
4. **Coexist** - Behavior Graph and traditional code can work together

## Performance Considerations

- Behavior Graph adds overhead for dependency tracking
- Excellent for typical application performance requirements
- Avoid for nanosecond-critical code paths
- Dynamic dependencies have additional cost
- Side effect deferral prevents some immediate operations

This foundation applies universally across all Behavior Graph platforms. Platform-specific syntax and patterns are covered in the platform-specific guides.
