# Behavior Graph for JavaScript/TypeScript - LLM Guide

## Overview

This guide covers JavaScript/TypeScript-specific implementation of Behavior Graph. For core concepts and architecture, see [BGforLLMs-Core.md](BGforLLMs-Core.md). This guide focuses on practical JavaScript/TypeScript syntax, patterns, and real-world examples.

## Installation & Setup

### NPM Installation
```bash
npm install behavior-graph
```

### Import Patterns

**ES6 Modules (Node.js/Modern browsers):**
```javascript
import * as bg from "behavior-graph";
```

**CommonJS (Node.js):**
```javascript
const bg = require("behavior-graph");
```

**CDN (Browser):**
```javascript
import * as bg from "https://cdn.skypack.dev/behavior-graph";
```

**Script Tag (Browser):**
```html
<script src="https://cdn.jsdelivr.net/npm/behavior-graph/lib/behavior-graph.min.js"></script>
<!-- Creates global 'bg' variable -->
```

### TypeScript Support
Behavior Graph is written in TypeScript and includes full type definitions. No additional @types package needed.

```typescript
import * as bg from "behavior-graph";

// Full type inference available
class MyExtent extends bg.Extent {
    constructor(graph: bg.Graph) {
        super(graph);
        
        // State signals are typed from initial value
        this.counter = this.state<number>(0);     // number
        this.name = this.state<string>("John");   // string
        this.items = this.state<Item[]>([]);      // Item[]
        
        // Event signals can specify payload type
        this.buttonClick = this.signal<MouseEvent>();
        this.apiResponse = this.signal<ApiData>();
    }
}
```

## Core JavaScript/TypeScript Syntax

### Graph Creation & Basic Setup

```javascript
import * as bg from "behavior-graph";

// Create the graph
const graph = new bg.Graph();

// Define your extent
class AppExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        // Signals
        this.counter = this.state(0);
        this.increment = this.signal();
        this.decrement = this.signal();
        
        // Behaviors
        this.behavior()
            .dependsOn(this.increment, this.decrement)
            .supplies(this.counter)
            .runs(() => {
                if (this.increment.justUpdated) {
                    this.counter.update(this.counter.value + 1);
                }
                if (this.decrement.justUpdated) {
                    this.counter.update(this.counter.value - 1);
                }
            });
    }
}

// Initialize
const app = new AppExtent(graph);
app.addToGraphWithAction();
```

### Signal Creation Patterns

```javascript
class MyExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        // State signals (persistent data)
        this.username = this.state("");
        this.isLoggedIn = this.state(false);
        this.userProfile = this.state(null);
        this.items = this.state([]);
        this.settings = this.state({theme: "light", notifications: true});
        
        // Event signals (events)
        this.loginClick = this.signal();
        this.logoutClick = this.signal();
        this.apiResponse = this.signal();  // Can carry data
        this.errorOccurred = this.signal();
        
        // Signals can have debug names
        this.counter = this.state(0, "counterValue");
    }
}
```

### Behavior Definition Patterns

```javascript
class ValidationExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        this.email = this.state("");
        this.password = this.state("");
        this.emailValid = this.state(false);
        this.passwordValid = this.state(false);
        this.formValid = this.state(false);
        this.submitClick = this.moment();
        
        // Simple validation behavior
        this.behavior()
            .dependsOn(this.email)
            .supplies(this.emailValid)
            .runs(() => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                this.emailValid.update(emailRegex.test(this.email.value));
            });
            
        // Multiple inputs, multiple outputs
        this.behavior()
            .dependsOn(this.emailValid, this.passwordValid)
            .supplies(this.formValid)
            .runs(() => {
                this.formValid.update(
                    this.emailValid.value && this.passwordValid.value
                );
            });
            
        // Event-driven behavior with conditions
        this.behavior()
            .dependsOn(this.submitClick, this.formValid)
            .runs(() => {
                if (this.submitClick.justUpdated && this.formValid.value) {
                    this.effect(() => {
                        console.log("Submitting form...");
                        // API call here
                    });
                }
            });
    }
}
```

### Dynamic Dependencies

```javascript
class DynamicExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        this.selectedUser = this.state(null);
        this.users = this.state([]);
        this.userDeleted = this.moment();
        
        // Dynamically depend on signals based on current selection
        this.behavior()
            .dependsOn(this.selectedUser, this.userDeleted)
            .dynamicDependsOn([this.selectedUser], () => {
                // Return array of signals to depend on
                const user = this.selectedUser.value;
                return user ? [user.nameChanged, user.statusChanged] : [];
            })
            .runs(() => {
                const user = this.selectedUser.value;
                if (user?.nameChanged.justUpdated) {
                    this.effect(() => {
                        updateUserDisplay(user.name.value);
                    });
                }
                if (this.userDeleted.justUpdated) {
                    // Handle user deletion
                }
            });
            
        // Dynamic supplies pattern
        this.behavior()
            .dependsOn(this.users)
            .dynamicSupplies([this.users], () => {
                return this.users.value.map(user => user.computed);
            })
            .runs(() => {
                // Update computed values for all users
                for (const user of this.users.value) {
                    user.computed.update(calculateValue(user));
                }
            });
    }
}
```

### Actions and External Input

```javascript
// Basic action pattern
graph.action(() => {
    myExtent.inputValue.update("new value");
    myExtent.triggerEvent.update();
});

// Action with debug name
graph.action(() => {
    myExtent.counter.update(myExtent.counter.value + 1);
}, "increment counter");

// Convenience method on resources
myExtent.counter.updateWithAction(42);
myExtent.buttonClick.updateWithAction();

// Async actions
await graph.actionAsync(() => {
    myExtent.startLongProcess.update();
});
```

### Effects Patterns

```javascript
class UIExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        this.message = this.state("");
        this.isLoading = this.state(false);
        this.theme = this.state("light");
        
        // DOM updates
        this.behavior()
            .dependsOn(this.message)
            .runs(() => {
                this.effect(() => {
                    document.getElementById("message").textContent = this.message.value;
                }, "update message display");
            });
            
        // API calls
        this.behavior()
            .dependsOn(this.isLoading)
            .runs(() => {
                if (this.isLoading.justUpdatedTo(true)) {
                    this.effect(async () => {
                        try {
                            const response = await fetch("/api/data");
                            const data = await response.json();
                            // Trigger next action
                            this.apiSuccess.updateWithAction(data);
                        } catch (error) {
                            this.apiError.updateWithAction(error.message);
                        }
                    }, "fetch data");
                }
            });
            
        // Multiple effects in one behavior
        this.behavior()
            .dependsOn(this.theme)
            .runs(() => {
                this.effect(() => {
                    document.body.className = `theme-${this.theme.value}`;
                }, "update body class");
                
                this.effect(() => {
                    localStorage.setItem("theme", this.theme.value);
                }, "save theme preference");
            });
    }
}
```

### Working with Arrays and Objects

```javascript
class CollectionExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        this.items = this.state([]);
        this.selectedItem = this.state(null);
        this.filter = this.state("");
        this.filteredItems = this.state([]);
        
        // Array manipulation
        this.behavior()
            .dependsOn(this.items, this.filter)
            .supplies(this.filteredItems)
            .runs(() => {
                const filtered = this.items.value.filter(item =>
                    item.name.toLowerCase().includes(this.filter.value.toLowerCase())
                );
                this.filteredItems.update(filtered);
            });
            
        // Object updates - use updateForce for object mutations
        this.behavior()
            .dependsOn(this.selectedItem)
            .runs(() => {
                if (this.selectedItem.justUpdated) {
                    // When working with object mutations
                    const item = this.selectedItem.value;
                    if (item) {
                        item.lastAccessed = Date.now();
                        // Force update to trigger dependent behaviors
                        this.selectedItem.updateForce(item);
                    }
                }
            });
    }
    
    addItem(newItem) {
        graph.action(() => {
            const currentItems = this.items.value;
            this.items.update([...currentItems, newItem]);
        });
    }
    
    removeItem(itemId) {
        graph.action(() => {
            const filtered = this.items.value.filter(item => item.id !== itemId);
            this.items.update(filtered);
        });
    }
}
```

## Browser Integration Examples

### DOM Event Handling

```javascript
class FormExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        this.email = this.state("");
        this.password = this.state("");
        this.submitClick = this.signal();
        
        // Set up DOM event listeners
        this.setupDOMListeners();
    }
    
    setupDOMListeners() {
        // Input changes
        document.getElementById("email").addEventListener("input", (event) => {
            this.email.updateWithAction(event.target.value);
        });
        
        document.getElementById("password").addEventListener("input", (event) => {
            this.password.updateWithAction(event.target.value);
        });
        
        // Button clicks
        document.getElementById("submit").addEventListener("click", () => {
            this.submitClick.updateWithAction();
        });
        
        // Custom events with data
        document.addEventListener("customEvent", (event) => {
            this.customEvent.updateWithAction(event.detail);
        });
    }
}
```

### Real-time Updates

```javascript
class RealtimeExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        this.connectionStatus = this.state("disconnected");
        this.messages = this.state([]);
        this.newMessage = this.signal();
        
        // WebSocket setup
        this.setupWebSocket();
        
        // Handle incoming messages
        this.behavior()
            .dependsOn(this.newMessage)
            .supplies(this.messages)
            .runs(() => {
                if (this.newMessage.justUpdated) {
                    const message = this.newMessage.value;
                    const currentMessages = this.messages.value;
                    this.messages.update([...currentMessages, message]);
                }
            });
    }
    
    setupWebSocket() {
        const ws = new WebSocket("ws://localhost:8080");
        
        ws.onopen = () => {
            this.connectionStatus.updateWithAction("connected");
        };
        
        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.newMessage.updateWithAction(message);
        };
        
        ws.onclose = () => {
            this.connectionStatus.updateWithAction("disconnected");
        };
    }
}
```

## React Integration

Using the `react-behavior-graph` adapter:

```bash
npm install react-behavior-graph
```

### Basic React Usage

```jsx
import React from 'react';
import {useBGState} from 'react-behavior-graph';

function CounterComponent({counterExtent}) {
    // Automatically re-renders when counter changes
    const count = useBGState(counterExtent.counter);
    const isLoading = useBGState(counterExtent.isLoading);
    
    return (
        <div>
            <h2>Count: {count}</h2>
            <button 
                onClick={() => counterExtent.increment.updateWithAction()}
                disabled={isLoading}
            >
                Increment
            </button>
            <button 
                onClick={() => counterExtent.decrement.updateWithAction()}
                disabled={isLoading}
            >
                Decrement
            </button>
        </div>
    );
}
```

### Complex React Integration

```jsx
function TodoApp({listExtent}) {
    const allItems = useBGState(listExtent.allItems);
    const viewState = useBGState(listExtent.viewState);
    const remainingCount = useBGState(listExtent.remainingCount);
    
    const handleAddItem = (event) => {
        if (event.key === 'Enter') {
            listExtent.addNewItem.updateWithAction(event.target.value);
            event.target.value = "";
        }
    };
    
    const filteredItems = allItems.filter(item => {
        if (viewState === "active") return !item.completed.value;
        if (viewState === "completed") return item.completed.value;
        return true;
    });
    
    return (
        <div>
            <input 
                placeholder="What needs to be done?"
                onKeyDown={handleAddItem}
            />
            <ul>
                {filteredItems.map(item => (
                    <TodoItem key={item.id} itemExtent={item} />
                ))}
            </ul>
            <footer>
                {remainingCount} items left
            </footer>
        </div>
    );
}
```

## Complete Working Examples

### 1. Login Form with Validation

```javascript
import * as bg from "behavior-graph";

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

class LoginExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        // State
        this.email = this.state("");
        this.password = this.state("");
        this.emailValid = this.state(false);
        this.passwordValid = this.state(false);
        this.loginEnabled = this.state(false);
        this.isLoggingIn = this.state(false);
        
        // Events
        this.loginClick = this.moment();
        this.loginComplete = this.moment();
        
        // Email validation
        this.behavior()
            .dependsOn(this.email)
            .supplies(this.emailValid)
            .runs(() => {
                this.emailValid.update(validateEmail(this.email.value));
                this.effect(() => {
                    const feedback = document.getElementById("emailFeedback");
                    feedback.textContent = this.emailValid.value ? "✓" : "✗";
                    feedback.className = this.emailValid.value ? "valid" : "invalid";
                });
            });
        
        // Password validation
        this.behavior()
            .dependsOn(this.password)
            .supplies(this.passwordValid)
            .runs(() => {
                const valid = this.password.value.length >= 6;
                this.passwordValid.update(valid);
                this.effect(() => {
                    const feedback = document.getElementById("passwordFeedback");
                    feedback.textContent = valid ? "✓" : "✗";
                    feedback.className = valid ? "valid" : "invalid";
                });
            });
        
        // Form validation
        this.behavior()
            .dependsOn(this.emailValid, this.passwordValid, this.isLoggingIn)
            .supplies(this.loginEnabled)
            .runs(() => {
                const enabled = this.emailValid.value && 
                              this.passwordValid.value && 
                              !this.isLoggingIn.value;
                this.loginEnabled.update(enabled);
                this.effect(() => {
                    document.getElementById("loginButton").disabled = !enabled;
                });
            });
        
        // Login process
        this.behavior()
            .dependsOn(this.loginClick, this.loginComplete)
            .supplies(this.isLoggingIn)
            .runs(() => {
                if (this.loginClick.justUpdated && this.loginEnabled.value) {
                    this.isLoggingIn.update(true);
                    this.effect(async () => {
                        try {
                            const response = await fetch("/api/login", {
                                method: "POST",
                                headers: {"Content-Type": "application/json"},
                                body: JSON.stringify({
                                    email: this.email.value,
                                    password: this.password.value
                                })
                            });
                            const success = response.ok;
                            this.loginComplete.updateWithAction(success);
                        } catch (error) {
                            this.loginComplete.updateWithAction(false);
                        }
                    });
                } else if (this.loginComplete.justUpdated) {
                    this.isLoggingIn.update(false);
                }
            });
    }
    
    setupDOM() {
        document.getElementById("email").addEventListener("input", (e) => {
            this.email.updateWithAction(e.target.value);
        });
        
        document.getElementById("password").addEventListener("input", (e) => {
            this.password.updateWithAction(e.target.value);
        });
        
        document.getElementById("loginButton").addEventListener("click", () => {
            this.loginClick.updateWithAction();
        });
    }
}

// Usage
const graph = new bg.Graph();
const login = new LoginExtent(graph);
login.addToGraphWithAction();
login.setupDOM();
```

### 2. Dynamic Todo List

```javascript
class TodoItemExtent extends bg.Extent {
    constructor(graph, text, completed = false) {
        super(graph);
        
        this.text = this.state(text);
        this.completed = this.state(completed);
        this.editing = this.state(false);
        this.remove = this.signal();
        
        // Auto-save when text changes
        this.behavior()
            .dependsOn(this.text, this.completed)
            .runs(() => {
                this.effect(() => {
                    this.saveToLocalStorage();
                });
            });
    }
    
    saveToLocalStorage() {
        // Implementation depends on parent list
    }
}

class TodoListExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        this.items = this.state([]);
        this.newItemText = this.state("");
        this.filter = this.state("all"); // all, active, completed
        this.visibleItems = this.state([]);
        
        // Events
        this.addItem = this.signal();
        this.clearCompleted = this.signal();
        
        // Add new items
        this.behavior()
            .dependsOn(this.addItem)
            .supplies(this.items)
            .runs(() => {
                if (this.addItem.justUpdated && this.newItemText.value.trim()) {
                    const newItem = new TodoItemExtent(
                        this.graph, 
                        this.newItemText.value.trim()
                    );
                    this.addChildLifetime(newItem);
                    newItem.addToGraph();
                    
                    this.items.update([...this.items.value, newItem]);
                    this.newItemText.update("");
                }
            });
        
        // Handle item removal
        this.behavior()
            .dependsOn(this.items)
            .dynamicDependsOn([this.items], () => {
                return this.items.value.map(item => item.remove);
            })
            .supplies(this.items)
            .runs(() => {
                const toRemove = this.items.value.filter(item => 
                    item.remove.justUpdated
                );
                
                if (toRemove.length > 0) {
                    const remaining = this.items.value.filter(item => 
                        !item.remove.justUpdated
                    );
                    
                    // Clean up removed items
                    toRemove.forEach(item => item.removeFromGraph());
                    
                    this.items.update(remaining);
                }
            });
        
        // Filter items
        this.behavior()
            .dependsOn(this.items, this.filter)
            .dynamicDependsOn([this.items], () => {
                return this.items.value.map(item => item.completed);
            })
            .supplies(this.visibleItems)
            .runs(() => {
                let filtered = this.items.value;
                
                if (this.filter.value === "active") {
                    filtered = filtered.filter(item => !item.completed.value);
                } else if (this.filter.value === "completed") {
                    filtered = filtered.filter(item => item.completed.value);
                }
                
                this.visibleItems.update(filtered);
            });
        
        // Clear completed
        this.behavior()
            .dependsOn(this.clearCompleted)
            .supplies(this.items)
            .runs(() => {
                if (this.clearCompleted.justUpdated) {
                    const active = this.items.value.filter(item => 
                        !item.completed.value
                    );
                    const toRemove = this.items.value.filter(item => 
                        item.completed.value
                    );
                    
                    toRemove.forEach(item => item.removeFromGraph());
                    this.items.update(active);
                }
            });
    }
}
```

## TypeScript Advanced Patterns

### Generic Extent Pattern

```typescript
interface DataItem {
    id: string;
    name: string;
    value: number;
}

class GenericListExtent<T extends {id: string}> extends bg.Extent {
    items = this.state<T[]>([]);
    selectedItem = this.state<T | null>(null);
    filter = this.state<string>("");
    
    constructor(graph: bg.Graph, private itemFactory: (data: any) => T) {
        super(graph);
        
        this.behavior()
            .dependsOn(this.items, this.filter)
            .supplies(this.filteredItems)
            .runs(() => {
                // Type-safe filtering
                const filtered = this.items.value.filter(item =>
                    this.matchesFilter(item, this.filter.value)
                );
                this.filteredItems.update(filtered);
            });
    }
    
    private matchesFilter(item: T, filter: string): boolean {
        // Override in subclasses
        return true;
    }
}

// Usage
class UserListExtent extends GenericListExtent<User> {
    constructor(graph: bg.Graph) {
        super(graph, (data) => new User(data));
    }
    
    protected matchesFilter(user: User, filter: string): boolean {
        return user.name.toLowerCase().includes(filter.toLowerCase());
    }
}
```

### Type-Safe Resource Factory

```typescript
class TypedExtent extends bg.Extent {
    // Typed state resources
    readonly counter: bg.State<number>;
    readonly user: bg.State<User | null>;
    readonly items: bg.State<Item[]>;
    
    // Typed event signals  
    readonly userLogin: bg.Signal<{email: string, timestamp: Date}>;
    readonly apiError: bg.Signal<Error>;
    
    constructor(graph: bg.Graph) {
        super(graph);
        
        // Initialize with proper typing
        this.counter = this.state<number>(0);
        this.user = this.state<User | null>(null);
        this.items = this.state<Item[]>([]);
        
        this.userLogin = this.signal<{email: string, timestamp: Date}>();
        this.apiError = this.signal<Error>();
        
        // Type-safe behavior
        this.behavior()
            .dependsOn(this.userLogin)
            .supplies(this.user)
            .runs(() => {
                if (this.userLogin.justUpdated) {
                    const loginData = this.userLogin.value; // Typed!
                    this.effect(async () => {
                        try {
                            const user = await fetchUser(loginData.email);
                            this.user.updateWithAction(user);
                        } catch (error) {
                            this.apiError.updateWithAction(error as Error);
                        }
                    });
                }
            });
    }
}
```

## API Quick Reference

### Graph Methods
```javascript
const graph = new bg.Graph();

// Actions
graph.action(() => { /* sync code */ });
await graph.actionAsync(() => { /* async code */ });

// Properties
graph.currentMoment         // Current Moment or null
graph.currentBehavior       // Currently running Behavior or null  
graph.lastMoment           // Last completed Moment

// Effects
graph.effect(() => { /* deferred code */ });
```

### Extent Methods
```javascript
class MyExtent extends bg.Extent {
    constructor(graph) {
        super(graph);
        
        // Signal factories
        this.state(initialValue, debugName?)
        this.signal(debugName?)
        
        // Behavior factory
        this.behavior()
        
        // Lifecycle
        this.addToGraph()
        this.addToGraphWithAction(debugName?)
        this.removeFromGraph(strategy?)
        this.removeFromGraphWithAction(strategy?, debugName?)
        
        // Hierarchy
        this.addChildLifetime(childExtent)
        this.unifyLifetime(otherExtent)
        
        // Actions and effects
        this.action(block, debugName?)
        this.actionAsync(block, debugName?)
        this.effect(block, debugName?)
    }
}
```

### Signal Methods
```javascript
// State<T>
state.value                    // T - current value
state.update(newValue)         // Update if different
state.updateForce(newValue)    // Update even if same
state.updateWithAction(newValue, debugName?)
state.justUpdated             // boolean
state.justUpdatedTo(value)    // boolean 
state.justUpdatedFrom(value)  // boolean
state.traceValue              // T - value at moment start
state.moment                  // Moment of last update

// Signal<T>  
signal.value                  // T | undefined - current payload
signal.update(payload?)       // Mark as updated
signal.updateWithAction(payload?, debugName?)
signal.justUpdated            // boolean
signal.justUpdatedTo(value)   // boolean
signal.moment                 // Moment | null

// Common properties
signal.order                  // Dependable for ordering
signal.suppliedBy            // Behavior | null
signal.extent                // Extent
signal.graph                 // Graph
```

### Behavior Builder
```javascript
this.behavior()
    .dependsOn(...signals)              // Static dependencies
    .supplies(...signals)               // Static supplies  
    .dynamicDependsOn(switches, linker, relinkingOrder?)
    .dynamicSupplies(switches, linker)
    .runs(extent => { /* behavior code */ });
```

## Common Patterns & Best Practices

### 1. Validation Pipeline
```javascript
// Chain validation behaviors
this.behavior()
    .dependsOn(this.rawInput)
    .supplies(this.cleanedInput)
    .runs(() => {
        this.cleanedInput.update(this.rawInput.value.trim());
    });

this.behavior()  
    .dependsOn(this.cleanedInput)
    .supplies(this.isValid, this.validationErrors)
    .runs(() => {
        const errors = validateInput(this.cleanedInput.value);
        this.validationErrors.update(errors);
        this.isValid.update(errors.length === 0);
    });
```

### 2. Async Operation Management
```javascript
this.behavior()
    .dependsOn(this.startOperation)
    .supplies(this.isLoading, this.operationId)
    .runs(() => {
        if (this.startOperation.justUpdated) {
            const id = generateId();
            this.operationId.update(id);
            this.isLoading.update(true);
            
            this.effect(async () => {
                try {
                    const result = await performOperation(id);
                    this.operationComplete.updateWithAction({id, result});
                } catch (error) {
                    this.operationError.updateWithAction({id, error});
                }
            });
        }
    });
```

### 3. State Machine Pattern
```javascript
this.behavior()
    .dependsOn(this.currentState, this.transitionEvent)
    .supplies(this.currentState)
    .runs(() => {
        if (this.transitionEvent.justUpdated) {
            const newState = this.getNextState(
                this.currentState.value, 
                this.transitionEvent.value
            );
            if (newState !== this.currentState.value) {
                this.currentState.update(newState);
            }
        }
    });
```

### 4. Debouncing Input
```javascript
this.behavior()
    .dependsOn(this.userInput)
    .supplies(this.debouncedInput)
    .runs(() => {
        this.effect(() => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.debouncedInput.updateWithAction(this.userInput.value);
            }, 300);
        });
    });
```

This guide provides the essential JavaScript/TypeScript patterns for using Behavior Graph effectively. For advanced scenarios and performance optimization, refer to the platform documentation and experiment with the provided examples.
