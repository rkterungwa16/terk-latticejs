# terk-latticejs

Minimal JavaScript frontend framework to help you connect your models and views.

One file, no dependencies, no build step. A **Model** owns reactive state and business logic; one or more **Views** subscribe to it, update the DOM, and report user input back. The model never touches the DOM, and views never contain business logic.

- 📖 **Docs:** [API reference](https://rkterungwa16.github.io/terk-latticejs/API)
- 🧪 **Example:** [Task manager](https://rkterungwa16.github.io/terk-latticejs/example/) ([source](https://github.com/rkterungwa16/terk-latticejs/tree/main/example))
- 🌐 **Site:** <https://rkterungwa16.github.io/terk-latticejs/>
- 🐛 **Issues:** <https://github.com/rkterungwa16/terk-latticejs/issues>

> **Note:** the library is exposed as the global `MV` (`MV.Model`, `MV.View`, …), as in the examples below and in the API reference.

## Features

- **Reactive state:** `Proxy`-backed state; assign a property and subscribers hear about it.
- **Batched updates:** many writes in a tick become one event per key, once per animation frame. Reads are always current.
- **Computed values:** declare derived state once (`total`, `visible`, …) and it stays in sync; it only publishes when the value really changes.
- **Pub/sub bus:** per-model `EventBus` with a `"*"` wildcard, handy for logging and debugging.
- **View lifecycle:** `mount()` / `destroy()` and tracked helpers (`subscribe`, `bind`, `twoWayBind`, `on`) that clean up after themselves.
- **DOM bindings:** one-way and two-way, with `WeakRef`-based self-cleanup.
- **Many views, one model:** add or remove views without touching the model.
- **Tested:** 132 unit tests, ~99% line coverage, zero test dependencies.

## Install

The library is a single file, `mv.js`. It's not published to npm yet.

**Script tag, hosted on GitHub Pages:**

```html
<script src="https://rkterungwa16.github.io/terk-latticejs/mv.js"></script>
```

**Or download** [`mv.js`](https://github.com/rkterungwa16/terk-latticejs/blob/main/mv.js) into your project:

```html
<script src="mv.js"></script>
```

It also loads with CommonJS (`require("./mv.js")`) and AMD. The core (`EventBus`, `reactive`, `Model`) runs in Node; the DOM helpers need a browser.

**Requirements:** a modern browser with `Proxy`, `WeakRef` and `requestAnimationFrame`.

## Quick start

```html
<button id="inc">+1</button>
<p>Count: <span id="count"></span> (<span id="parity"></span>)</p>

<script src="https://rkterungwa16.github.io/terk-latticejs/mv.js"></script>
<script>
  const { Model, View } = MV;

  // Model: state, derived values, commands. No DOM.
  class CounterModel extends Model {
    constructor() {
      super(
        { count: 0 },
        { computed: { parity: (s) => (s.count % 2 === 0 ? "even" : "odd") } },
      );
    }
    increment() {
      this.state.count++;
    }
  }

  // View: DOM only. Reads from the bus, reports input via callbacks.
  class CounterView extends View {
    constructor(bus, state, onIncrement) {
      super(bus, state);
      this._onIncrement = onIncrement;
    }
    render() {}
    bindEvents() {
      this.bind("count", "#count");
      this.bind("parity", "#parity");
      this.on(document.getElementById("inc"), "click", this._onIncrement);
    }
  }

  const model = new CounterModel();
  new CounterView(model.bus, model.state, () => model.increment()).mount();
</script>
```

## How it works

```
 user input ──► View ──callback──► Model command ──► state write
                 ▲                                       │
                 └──────────── bus event ◄───────────────┘
                         (batched, once per frame)
```

1. A user action reaches a **View**, which calls a callback you passed in.
2. The callback runs a **Model** command, which assigns to `this.state`.
3. Computed values update immediately; change events are batched and published on the model's bus on the next frame.
4. Every subscribed view updates its part of the DOM.

Rules worth knowing:

- **Replace, don't mutate.** `state.tasks = [...state.tasks, task]` is seen; `state.tasks.push(task)` is not.
- Reactivity is **shallow and top-level**.
- Writes that are shallow-equal to the current value are ignored.

## Documentation

Full reference with examples: **<https://rkterungwa16.github.io/terk-latticejs/API>**

| Section | Covers |
|---|---|
| [`EventBus`](https://rkterungwa16.github.io/terk-latticejs/API#eventbus) | `subscribe`, `publish`, the `"*"` wildcard |
| [`reactive()`](https://rkterungwa16.github.io/terk-latticejs/API#reactiveinitial-bus-options--state) | batching, equality rules, `computed`, `scheduler` |
| [`Model`](https://rkterungwa16.github.io/terk-latticejs/API#model) | `bus`, `state`, `on()`, command convention |
| [`View`](https://rkterungwa16.github.io/terk-latticejs/API#view) | lifecycle, `bind`, `twoWayBind`, `on`, `destroy` |
| [Low-level bindings](https://rkterungwa16.github.io/terk-latticejs/API#low-level-bindings) | standalone `bind` / `twoWayBind` |
| [Utilities](https://rkterungwa16.github.io/terk-latticejs/API#utilities) | `escapeHtml`, `shallowEqual`, `summarise` |
| [Task manager example](https://rkterungwa16.github.io/terk-latticejs/API#example-task-manager) | a full walkthrough |
| [Known limitations](https://rkterungwa16.github.io/terk-latticejs/API#known-limitations-v1) | what v1 doesn't do |

## Example: task manager

A complete app built on the framework: add, complete and delete tasks, filter them, live stats, and a second view that logs every model event.

- **Live demo:** <https://rkterungwa16.github.io/terk-latticejs/example/>
- **Source:** [`example/index.html`](https://github.com/rkterungwa16/terk-latticejs/blob/main/example/index.html) and [`example/task-manager.js`](https://github.com/rkterungwa16/terk-latticejs/blob/main/example/task-manager.js)

To run it locally, open `example/index.html` in a browser.

## Development

```bash
git clone https://github.com/rkterungwa16/terk-latticejs.git
cd terk-latticejs

npm test            # run the unit tests (Node 18+, no dependencies)
npm run coverage    # tests with a coverage report
```

### Project layout

```
mv.js                  the framework (single file)
API.md                 API reference (published as the /API page)
example/               task manager demo
test/mv.test.js        unit tests (node:test + a small fake DOM)
package.json
```

## Known limitations (v1)

- Shallow, top-level reactivity: replace arrays and objects rather than mutating them.
- Views re-render lists wholesale (no virtual DOM or keyed diffing).
- `bind` / `twoWayBind` write `.textContent` and `.value` only; use `this.subscribe(...)` for attributes, classes or styles.
- Events are delivered on the next frame; reading `state` is always synchronous and current.

## Contributing

Issues and pull requests are welcome at <https://github.com/rkterungwa16/terk-latticejs>. Please run `npm test` before opening a PR.

## License

MIT
