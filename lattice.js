/*!
 * LatticeJS — a tiny Model/View framework with pub/sub data binding.  v1.0.0
 *
 * Layers
 *   0. EventBus   — pub/sub with wildcard ("*") subscription
 *   1. reactive() — Proxy-backed state; batched change events; computed values
 *   2. bind() / twoWayBind() — state key <-> DOM element helpers
 *   3. Model      — owns state + business logic, publishes on its own bus
 *   4. View       — owns binding/listener lifecycle; subclass it per UI region
 *
 * Works as a plain <script> (global `MV`), CommonJS, or AMD.
 */
(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MV = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "1.0.0";

  // ═════════════════════════════════════════════════════════════════════════
  //  UTILITIES
  // ═════════════════════════════════════════════════════════════════════════

  /** Shallow equality for primitives, arrays and plain objects. */
  function shallowEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== "object" || typeof b !== "object") return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  }

  /** Escape a string for safe insertion into HTML. */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Short human-readable description of a value (handy for logging). */
  function summarise(value) {
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === "object" && value !== null)
      return JSON.stringify(value).slice(0, 60);
    return JSON.stringify(value);
  }

  const resolveEl = (sel) =>
    typeof sel === "string" ? document.querySelector(sel) : sel;

  const defaultScheduler =
    typeof requestAnimationFrame === "function"
      ? (fn) => requestAnimationFrame(fn)
      : (fn) => setTimeout(fn, 0);

  // ═════════════════════════════════════════════════════════════════════════
  //  LAYER 0 — EVENT BUS
  // ═════════════════════════════════════════════════════════════════════════

  class EventBus {
    constructor() {
      this._subs = new Map(); // event -> Map(id -> fn)
      this._nextId = 0;
    }

    /**
     * Subscribe to an event name, or "*" for every event.
     * "*" handlers receive `{ event, payload }`.
     * @returns {() => void} unsubscribe function
     */
    subscribe(event, fn) {
      if (!this._subs.has(event)) this._subs.set(event, new Map());
      const handlers = this._subs.get(event);
      const id = this._nextId++;
      handlers.set(id, fn);
      return () => handlers.delete(id);
    }

    /** Publish `payload` to subscribers of `event`, then to "*" subscribers. */
    publish(event, payload) {
      this._subs.get(event)?.forEach((fn) => fn(payload));
      this._subs.get("*")?.forEach((fn) => fn({ event, payload }));
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  LAYER 1 — REACTIVE STATE
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Wrap `initial` in a reactive Proxy.
   *
   * - Writes update the state immediately (reads are always current).
   * - Change events are batched: all writes in one tick publish once per key,
   *   on the next animation frame, as `{ key, value, prev }`.
   * - A write is ignored if `shallowEqual(old, new)`; mutate by replacing
   *   arrays/objects, not by editing them in place.
   * - `options.computed` declares derived keys: `{ key: (state) => value }`.
   *   They are recomputed synchronously after every write to a non-computed
   *   key, in declaration order (so later ones may read earlier ones).
   *
   * @param {Object}   initial
   * @param {EventBus} bus
   * @param {Object}   [options]
   * @param {Object<string,(state:Object)=>any>} [options.computed]
   * @param {(fn:Function)=>void} [options.scheduler]  flush scheduler
   */
  function reactive(initial, bus, options = {}) {
    const computed = options.computed || {};
    const schedule = options.scheduler || defaultScheduler;
    const target = { ...initial };
    const before = new Map(); // key -> value at the start of the current batch
    let scheduled = false;
    let proxy;

    function flush() {
      scheduled = false;
      const batch = [...before];
      before.clear();
      for (const [key, prev] of batch) {
        if (shallowEqual(prev, target[key])) continue; // changed and changed back
        bus.publish(key, { key, value: target[key], prev });
      }
    }

    function write(key, value) {
      const prev = target[key];
      if (shallowEqual(prev, value)) return;
      if (!before.has(key)) before.set(key, prev);
      target[key] = value;
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    }

    function recompute() {
      for (const key of Object.keys(computed)) write(key, computed[key](proxy));
    }

    proxy = new Proxy(target, {
      set(_t, key, value) {
        if (typeof key === "symbol" || key in computed) {
          if (key in computed)
            throw new Error(`"${key}" is computed and cannot be assigned`);
          target[key] = value;
          return true;
        }
        write(key, value);
        recompute();
        return true;
      },
    });

    recompute();
    before.clear(); // initial computed values are not "changes"
    scheduled = false;
    return proxy;
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  LAYER 2 — DOM BINDING
  // ═════════════════════════════════════════════════════════════════════════

  const isFormField = (el) =>
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement;

  /**
   * One-way bind: state key -> element. Inputs get `.value`, everything else
   * `.textContent`. Holds the element weakly and unsubscribes itself if the
   * element is garbage collected.
   * @returns {() => void} unbind function
   */
  function bind(bus, key, selector, transform = (v) => v) {
    const el = resolveEl(selector);
    if (!el) return () => {};
    const field = isFormField(el);
    const ref = new WeakRef(el);
    let unsub;
    unsub = bus.subscribe(key, ({ value }) => {
      const node = ref.deref();
      if (!node) return unsub?.();
      if (field) node.value = transform(value);
      else node.textContent = transform(value);
    });
    return unsub;
  }

  /**
   * Two-way bind: state key <-> form field. Typing writes to `state[key]`
   * (through `coerce`); state changes write back to the field.
   * @returns {() => void} unbind function
   */
  function twoWayBind(bus, state, key, selector, coerce = (v) => v) {
    const el = resolveEl(selector);
    if (!el) return () => {};
    const ref = new WeakRef(el);
    const onInput = (e) => {
      state[key] = coerce(e.target.value);
    };
    el.addEventListener("input", onInput);
    const unsub = bind(bus, key, el);
    return () => {
      ref.deref()?.removeEventListener("input", onInput);
      unsub();
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  LAYER 3 — MODEL
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Base class for application models. Owns a bus and reactive state, knows
   * nothing about the DOM. Subclass it and add command methods that assign to
   * `this.state`.
   */
  class Model {
    /**
     * @param {Object} initialState
     * @param {Object} [options]
     * @param {Object<string,(state:Object)=>any>} [options.computed]
     * @param {(fn:Function)=>void} [options.scheduler]
     */
    constructor(initialState = {}, options = {}) {
      this.bus = new EventBus();
      this.state = reactive(initialState, this.bus, options);
    }

    /** Subscribe to a state key (or "*"). Returns an unsubscribe function. */
    on(key, fn) {
      return this.bus.subscribe(key, fn);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  LAYER 4 — VIEW
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Base class for views. A view reacts to a model's bus and reports user
   * input through callbacks; it contains no business logic. Everything
   * registered through the tracked helpers is released by destroy().
   */
  class View {
    /**
     * @param {EventBus}    bus   model's bus
     * @param {Object}      state model's reactive state (read for initial paint)
     * @param {Element|null} root DOM element this view manages
     */
    constructor(bus, state, root = null) {
      this._bus = bus;
      this._state = state;
      this._root = root;
      this._teardowns = [];
      this._mounted = false;
    }

    /** Initial paint + wiring. Idempotent. */
    mount() {
      if (this._mounted) return this;
      this._mounted = true;
      this.render();
      this.bindEvents();
      return this;
    }

    /** Remove every subscription and DOM listener. */
    destroy() {
      this._teardowns.forEach((fn) => fn());
      this._teardowns = [];
      this._mounted = false;
    }

    /** Tracked bus subscription. */
    subscribe(event, fn) {
      const unsub = this._bus.subscribe(event, fn);
      this._teardowns.push(unsub);
      return unsub;
    }

    /** Tracked one-way bind (paints the current value immediately). */
    bind(key, selector, transform = (v) => v) {
      const el = resolveEl(selector);
      if (el && key in this._state) {
        const v = transform(this._state[key]);
        if (isFormField(el)) el.value = v;
        else el.textContent = v;
      }
      const unsub = bind(this._bus, key, el, transform);
      this._teardowns.push(unsub);
      return unsub;
    }

    /** Tracked two-way bind (paints the current value immediately). */
    twoWayBind(state, key, selector, coerce) {
      const el = resolveEl(selector);
      if (el && key in state) el.value = state[key];
      const unsub = twoWayBind(this._bus, state, key, el, coerce);
      this._teardowns.push(unsub);
      return unsub;
    }

    /** Tracked DOM listener. */
    on(el, event, fn, options) {
      el.addEventListener(event, fn, options);
      const off = () => el.removeEventListener(event, fn, options);
      this._teardowns.push(off);
      return off;
    }

    /** Subclass hook: paint the initial DOM. */
    render() {
      throw new Error(`${this.constructor.name} must implement render()`);
    }

    /** Subclass hook: wire subscriptions and DOM listeners. */
    bindEvents() {
      throw new Error(`${this.constructor.name} must implement bindEvents()`);
    }
  }

  return {
    VERSION,
    EventBus,
    reactive,
    bind,
    twoWayBind,
    Model,
    View,
    shallowEqual,
    escapeHtml,
    summarise,
  };
});
