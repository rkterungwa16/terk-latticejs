# MV — API Reference (v1.0.0)

MV is a tiny Model/View framework built on pub/sub data binding. A **Model** owns reactive state and business logic and publishes change events on its own bus. One or more **Views** subscribe to that bus, update the DOM, and report user input back through callbacks. Views never contain business logic, and the Model never touches the DOM.

```
 user input ──► View ──callback──► Model command ──► state write
                 ▲                                       │
                 └──────────── bus event ◄───────────────┘
                         (batched, once per frame)
```

- **Size:** one file, `mv.js`, no dependencies
- **Environment:** modern browsers (uses `Proxy`, `WeakRef`, `requestAnimationFrame`)
- **Core logic** (`EventBus`, `reactive`, `Model`) also runs in Node.

## Installation

```html
<script src="mv.js"></script>
<script>
  const { Model, View } = MV;
</script>
```

Also loadable with CommonJS (`require("./mv.js")`) or AMD.

## Exports

| Name | Kind | Purpose |
|---|---|---|
| `MV.VERSION` | string | Framework version |
| `MV.EventBus` | class | Pub/sub with wildcard |
| `MV.reactive` | function | Reactive state with batched events and computed values |
| `MV.bind` / `MV.twoWayBind` | functions | Low-level state ↔ DOM bindings |
| `MV.Model` | class | Base class for models |
| `MV.View` | class | Base class for views (lifecycle + tracked helpers) |
| `MV.escapeHtml` / `MV.shallowEqual` / `MV.summarise` | functions | Utilities |

---

## `EventBus`

```js
const bus = new MV.EventBus();
```

### `bus.subscribe(event, fn) → unsubscribe`

Registers `fn` for `event`. Returns a function that removes the subscription.
Use `"*"` to receive every event; wildcard handlers get `{ event, payload }`.

```js
const off = bus.subscribe("count", (payload) => console.log(payload));
bus.subscribe("*", ({ event, payload }) => console.log(event, payload));
off();
```

### `bus.publish(event, payload)`

Calls every subscriber of `event`, then every `"*"` subscriber, synchronously.

---

## `reactive(initial, bus, [options]) → state`

Wraps a copy of `initial` in a Proxy. Assigning to a property updates state **immediately** (reads are always current) and schedules a **batched** event.

```js
const bus = new MV.EventBus();
const state = MV.reactive({ count: 0 }, bus);

bus.subscribe("count", ({ key, value, prev }) => {});
state.count = 1;
state.count = 2;      // one event for the frame: { key: "count", value: 2, prev: 0 }
```

### Event payload

`{ key, value, prev }` is published on the bus under the property name. `prev` is the value at the start of the batch.

### Rules

- **Batching:** all writes in one tick produce at most one event per key, delivered on the next animation frame.
- **Equality check:** a write is ignored if `shallowEqual(old, new)`. If a key changes and changes back within a frame, no event fires.
- **Replace, don't mutate.** In-place edits (`state.tasks.push(x)`) are invisible. Assign a new array or object instead: `state.tasks = [...state.tasks, x]`.
- Only top-level keys are reactive.

### `options`

| Option | Type | Description |
|---|---|---|
| `computed` | `{ [key]: (state) => value }` | Derived values (see below) |
| `scheduler` | `(fn) => void` | Overrides the flush scheduler (default `requestAnimationFrame`, or `setTimeout` outside browsers). Useful in tests. |

### Computed values

Computed keys are recomputed synchronously after every write to a non-computed key, in declaration order, so later entries can read earlier ones. They publish events like any other key, and only when their value actually changes. They are read-only; assigning one throws.

```js
const state = MV.reactive({ n: 2 }, bus, {
  computed: {
    double: (s) => s.n * 2,
    quad: (s) => s.double * 2,
  },
});
state.n = 5;
state.quad; // 20 (immediately)
```

---

## `Model`

Base class for application models. Owns `bus` and `state`; has no DOM knowledge.

```js
class CounterModel extends MV.Model {
  constructor() {
    super({ count: 0 }, { computed: { isEven: (s) => s.count % 2 === 0 } });
  }
  increment() {
    this.state.count++;
  }
}
```

### `new Model(initialState = {}, options = {})`

`options` is passed to `reactive()` (`computed`, `scheduler`).

### Properties

| Property | Description |
|---|---|
| `model.bus` | The model's `EventBus`. Pass this to views. |
| `model.state` | The reactive state object. |

### `model.on(key, fn) → unsubscribe`

Shorthand for `model.bus.subscribe(key, fn)`.

**Convention:** expose *commands* as methods (`addTask`, `toggleTask`) that assign to `this.state`. Views call commands; they don't write state themselves (except through `twoWayBind`).

---

## `View`

Base class for views. Handles the binding lifecycle: anything registered through the tracked helpers is released by `destroy()`.

```js
class CounterView extends MV.View {
  constructor(bus, state, onInc) {
    super(bus, state, document.getElementById("counter"));
    this._onInc = onInc;
  }
  render() {}                                  // initial paint
  bindEvents() {
    this.bind("count", "#count-label");        // model → DOM
    this.on(document.getElementById("inc"), "click", this._onInc); // DOM → model
  }
}

const model = new CounterModel();
const view = new CounterView(model.bus, model.state, () => model.increment());
view.mount();
```

### `new View(bus, state, root = null)`

| Parameter | Description |
|---|---|
| `bus` | The model's bus (`model.bus`) |
| `state` | The model's reactive state, read for the initial paint |
| `root` | The DOM element this view manages (optional) |

### Lifecycle

| Method | Description |
|---|---|
| `view.mount()` | Calls `render()` then `bindEvents()`. Idempotent. Returns the view (chainable). |
| `view.destroy()` | Unsubscribes everything and removes every DOM listener registered through the tracked helpers. |
| `render()` | **Abstract.** Paint the initial DOM from `this._state`. |
| `bindEvents()` | **Abstract.** Subscribe to the model and attach DOM listeners. |

Both abstract methods throw if a subclass doesn't implement them (use an empty method if you have nothing to do).

### Tracked helpers

All of these are released by `destroy()`.

| Method | Description |
|---|---|
| `this.subscribe(event, fn)` | Subscribe to the model bus. Returns the unsubscribe function. |
| `this.bind(key, selector, transform?)` | One-way: state key → element. Paints the current value immediately, then follows changes. Form fields get `.value`; other elements get `.textContent`. `selector` is a CSS selector or an element. |
| `this.twoWayBind(state, key, selector, coerce?)` | Two-way: typing in a form field writes `state[key]` (through `coerce`); state changes update the field. |
| `this.on(el, event, fn, options?)` | `addEventListener` with automatic removal. Returns an off function. |

Instance fields available to subclasses: `this._bus`, `this._state`, `this._root`.

---

## Low-level bindings

`View.bind` and `View.twoWayBind` wrap these. Use them directly when you are not using a `View`.

### `bind(bus, key, selector, transform = v => v) → unbind`

Updates the element when `key` changes. Does **not** paint the initial value. The element is held with a `WeakRef`; the subscription removes itself if the element is garbage collected. Returns a no-op if `selector` matches nothing.

### `twoWayBind(bus, state, key, selector, coerce = v => v) → unbind`

Adds an `input` listener that writes `state[key] = coerce(value)`, plus a `bind()` for the reverse direction.

```js
MV.twoWayBind(model.bus, model.state, "age", "#age", Number);
```

---

## Utilities

| Function | Description |
|---|---|
| `escapeHtml(str)` | Escapes `& < > " '`. Use it for any user text put into `innerHTML`. |
| `shallowEqual(a, b)` | Strict equality for primitives; key-by-key `===` for arrays and plain objects. |
| `summarise(value)` | Short string for logging: `[3 items]`, truncated JSON, etc. |

---

## Example: Task Manager

Files: `example/index.html` (markup and styles) and `example/task-manager.js` (all app code). Open `example/index.html` in a browser; no build step is needed.

### 1. Model: state, computed stats, commands

```js
class TaskModel extends MV.Model {
  constructor() {
    super(
      { tasks: [], filter: "all" },
      {
        computed: {
          total:  (s) => s.tasks.length,
          done:   (s) => s.tasks.filter((t) => t.done).length,
          active: (s) => s.total - s.done,
          high:   (s) => s.tasks.filter((t) => t.priority === "high" && !t.done).length,
          pct:    (s) => (s.total ? Math.round((s.done / s.total) * 100) : 0),
          visible: (s) => {
            switch (s.filter) {
              case "active": return s.tasks.filter((t) => !t.done);
              case "done":   return s.tasks.filter((t) => t.done);
              case "high":   return s.tasks.filter((t) => t.priority === "high");
              default:       return [...s.tasks];
            }
          },
        },
      },
    );
    this._nextId = 1;
  }

  addTask(title, priority = "medium") {
    if (!title.trim()) return;
    this.state.tasks = [...this.state.tasks,
      { id: this._nextId++, title: title.trim(), priority, done: false, created: Date.now() }];
  }
  toggleTask(id) {
    this.state.tasks = this.state.tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t);
  }
  deleteTask(id) { this.state.tasks = this.state.tasks.filter((t) => t.id !== id); }
  setFilter(filter) { this.state.filter = filter; }
}
```

Commands only touch `tasks` and `filter`. The stats and the filtered list update themselves via `computed`.

### 2. View: rendering and user input

```js
class TaskView extends MV.View {
  constructor(bus, state, callbacks) {
    super(bus, state, document.getElementById("task-list"));
    this._cb = callbacks;
    // ...cache element references...
  }

  render() { this._renderList(this._state.visible); /* ... */ }

  bindEvents() {
    // Model → View
    this.subscribe("visible", ({ value }) => this._renderList(value));
    this.bind("total", "#stat-total", String);
    this.bind("pct", "#stat-pct", (v) => `${v}%`);

    // View → Model (via callbacks; no business logic here)
    this.on(this._elBtnAdd, "click", () =>
      this._cb.onAdd(this._elTitle.value, this._elPrio.value));

    // One delegated listener serves every re-rendered item
    this.on(this._elList, "click", (e) => {
      const id = Number(e.target.closest("[data-id]")?.dataset.id);
      if (e.target.closest(".task-check"))  this._cb.onToggle(id);
      if (e.target.closest(".task-delete")) this._cb.onDelete(id);
    });
  }
}
```

### 3. A second view on the same model

`LogView` uses the `"*"` wildcard to log every model event, with no coupling to `TaskView`:

```js
class LogView extends MV.View {
  bindEvents() {
    this.subscribe("*", ({ event, payload }) => {
      /* append a log row: `${event} → ${MV.summarise(payload.value)}` */
    });
  }
}
```

### 4. Bootstrap

```js
const model = new TaskModel();

new TaskView(model.bus, model.state, {
  onAdd:    (title, priority) => model.addTask(title, priority),
  onToggle: (id) => model.toggleTask(id),
  onDelete: (id) => model.deleteTask(id),
  onFilter: (f)  => model.setFilter(f),
}).mount();

new LogView(model.bus, model.state).mount();
```

The view receives only the bus, the state and callbacks, never the model object. Swapping or adding views needs no model changes.

---

## Known limitations (v1)

- Reactivity is shallow and top-level: replace arrays/objects rather than mutating them.
- Views re-render their lists wholesale (no virtual DOM or keyed diffing).
- `bind` / `twoWayBind` use `.textContent` and `.value` only; for attributes, classes or styles, use `this.subscribe(...)`.
- Event delivery is asynchronous (next frame). Reading `state` is always synchronous and current.
