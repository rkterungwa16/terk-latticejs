"use strict";

/*
 * Unit tests for latticejs.js — run with:  node --test
 *
 * Zero dependencies: uses Node's built-in test runner and a tiny fake DOM
 * (just enough of `document`, input elements and event listeners to exercise
 * bind / twoWayBind / View).
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// ─────────────────────────────────────────────────────────────────────────────
//  Fake DOM
// ─────────────────────────────────────────────────────────────────────────────

class FakeNode {
  constructor() {
    this._listeners = new Map();
    this.textContent = "";
  }
  addEventListener(type, fn, options) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, options });
  }
  removeEventListener(type, fn, options) {
    const list = this._listeners.get(type) || [];
    const i = list.findIndex((l) => l.fn === fn && l.options === options);
    if (i >= 0) list.splice(i, 1);
  }
  listenerCount(type) {
    return (this._listeners.get(type) || []).length;
  }
  listenerOptions(type) {
    return (this._listeners.get(type) || []).map((l) => l.options);
  }
  dispatch(type, extra = {}) {
    const event = { type, target: this, ...extra };
    for (const { fn } of [...(this._listeners.get(type) || [])]) fn(event);
    return event;
  }
}
class HTMLInputElement extends FakeNode {
  constructor() {
    super();
    this.value = "";
  }
}
class HTMLSelectElement extends FakeNode {
  constructor() {
    super();
    this.value = "";
  }
}
class HTMLTextAreaElement extends FakeNode {
  constructor() {
    super();
    this.value = "";
  }
}

const registry = new Map();
const fakeDocument = {
  querySelector: (sel) => registry.get(sel) ?? null,
};
const mount = (sel, el) => (registry.set(sel, el), el);

Object.assign(globalThis, {
  document: fakeDocument,
  HTMLInputElement,
  HTMLSelectElement,
  HTMLTextAreaElement,
});

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MV_PATH = path.resolve(__dirname, "../lattice.js");

/** Load a fresh copy of lattice.js (the default scheduler is chosen at load time). */
function loadMV() {
  delete require.cache[MV_PATH];
  return require(MV_PATH);
}

const MV = loadMV();
const { EventBus, reactive, bind, twoWayBind, Model, View } = MV;
const { escapeHtml, shallowEqual, summarise } = MV;

/** Deterministic scheduler: nothing runs until `.run()` is called. */
function manualScheduler() {
  const queue = [];
  const fn = (f) => {
    fn.calls++;
    queue.push(f);
  };
  fn.calls = 0;
  fn.pending = () => queue.length;
  fn.run = () => {
    while (queue.length) queue.shift()();
  };
  return fn;
}

/** Collect every payload published on `key`. */
function collect(bus, key) {
  const seen = [];
  bus.subscribe(key, (p) => seen.push(p));
  return seen;
}

const sleep = (ms = 10) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => registry.clear());

// ═════════════════════════════════════════════════════════════════════════════
//  Package surface
// ═════════════════════════════════════════════════════════════════════════════

describe("package surface", () => {
  it("exports the documented API", () => {
    for (const name of [
      "EventBus",
      "reactive",
      "bind",
      "twoWayBind",
      "Model",
      "View",
      "escapeHtml",
      "shallowEqual",
      "summarise",
    ]) {
      assert.equal(typeof MV[name], "function", name);
    }
  });

  it("exposes a semver VERSION string", () => {
    assert.match(MV.VERSION, /^\d+\.\d+\.\d+$/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Utilities
// ═════════════════════════════════════════════════════════════════════════════

describe("escapeHtml", () => {
  it("escapes & < > \" and '", () => {
    assert.equal(
      escapeHtml(`<a href="x">Tom & 'Jerry'</a>`),
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });

  it("escapes ampersands first (no double-escaping of its own output)", () => {
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });

  it("leaves safe text untouched", () => {
    assert.equal(escapeHtml("plain text 123"), "plain text 123");
  });

  it("coerces non-strings", () => {
    assert.equal(escapeHtml(42), "42");
    assert.equal(escapeHtml(null), "null");
    assert.equal(escapeHtml(undefined), "undefined");
  });

  it("neutralises a script injection", () => {
    const out = escapeHtml("<script>alert(1)</script>");
    assert.ok(!out.includes("<"));
    assert.ok(!out.includes(">"));
  });
});

describe("shallowEqual", () => {
  it("is true for identical references and equal primitives", () => {
    const o = {};
    assert.equal(shallowEqual(o, o), true);
    assert.equal(shallowEqual(1, 1), true);
    assert.equal(shallowEqual("a", "a"), true);
    assert.equal(shallowEqual(null, null), true);
    assert.equal(shallowEqual(undefined, undefined), true);
  });

  it("is false for different primitives and mixed types", () => {
    assert.equal(shallowEqual(1, 2), false);
    assert.equal(shallowEqual(1, "1"), false);
    assert.equal(shallowEqual(0, false), false);
    assert.equal(shallowEqual({}, 1), false);
    assert.equal(shallowEqual(1, {}), false);
  });

  it("treats null and undefined as unequal to objects and to each other", () => {
    assert.equal(shallowEqual(null, {}), false);
    assert.equal(shallowEqual({}, null), false);
    assert.equal(shallowEqual(null, undefined), false);
  });

  it("compares plain objects key by key with ===", () => {
    assert.equal(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
    assert.equal(shallowEqual({ a: 1 }, { a: 2 }), false);
    assert.equal(shallowEqual({ a: 1 }, { a: 1, b: 2 }), false);
    assert.equal(shallowEqual({ a: 1, b: 2 }, { a: 1 }), false);
    assert.equal(shallowEqual({ a: 1 }, { b: 1 }), false);
  });

  it("does not compare nested objects deeply", () => {
    assert.equal(shallowEqual({ a: {} }, { a: {} }), false);
    const inner = {};
    assert.equal(shallowEqual({ a: inner }, { a: inner }), true);
  });

  it("compares arrays element by element", () => {
    const x = { id: 1 };
    assert.equal(shallowEqual([x, 2], [x, 2]), true);
    assert.equal(shallowEqual([1, 2], [1, 2, 3]), false);
    assert.equal(shallowEqual([{ id: 1 }], [{ id: 1 }]), false);
    assert.equal(shallowEqual([], []), true);
  });
});

describe("summarise", () => {
  it("summarises arrays by length", () => {
    assert.equal(summarise([1, 2, 3]), "[3 items]");
    assert.equal(summarise([]), "[0 items]");
  });

  it("serialises primitives as JSON", () => {
    assert.equal(summarise(5), "5");
    assert.equal(summarise("hi"), '"hi"');
    assert.equal(summarise(true), "true");
    assert.equal(summarise(null), "null");
  });

  it("serialises small objects", () => {
    assert.equal(summarise({ a: 1 }), '{"a":1}');
  });

  it("truncates long objects to 60 characters", () => {
    const out = summarise({ text: "x".repeat(200) });
    assert.equal(out.length, 60);
  });

  it("returns undefined (JSON.stringify's result) for undefined", () => {
    assert.equal(summarise(undefined), undefined);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  EventBus
// ═════════════════════════════════════════════════════════════════════════════

describe("EventBus", () => {
  it("delivers payloads to subscribers of that event", () => {
    const bus = new EventBus();
    const got = collect(bus, "a");
    bus.publish("a", 1);
    bus.publish("a", { x: 2 });
    assert.deepEqual(got, [1, { x: 2 }]);
  });

  it("does not deliver events to subscribers of other events", () => {
    const bus = new EventBus();
    const a = collect(bus, "a");
    const b = collect(bus, "b");
    bus.publish("a", 1);
    assert.deepEqual(a, [1]);
    assert.deepEqual(b, []);
  });

  it("calls multiple subscribers in subscription order", () => {
    const bus = new EventBus();
    const order = [];
    bus.subscribe("e", () => order.push(1));
    bus.subscribe("e", () => order.push(2));
    bus.subscribe("e", () => order.push(3));
    bus.publish("e");
    assert.deepEqual(order, [1, 2, 3]);
  });

  it("does not throw when publishing with no subscribers", () => {
    assert.doesNotThrow(() => new EventBus().publish("nobody", 1));
  });

  it("returns an unsubscribe function that stops delivery", () => {
    const bus = new EventBus();
    const got = [];
    const off = bus.subscribe("a", (p) => got.push(p));
    bus.publish("a", 1);
    off();
    bus.publish("a", 2);
    assert.deepEqual(got, [1]);
  });

  it("unsubscribing is idempotent and leaves other subscribers alone", () => {
    const bus = new EventBus();
    const a = [];
    const b = [];
    const offA = bus.subscribe("e", (p) => a.push(p));
    bus.subscribe("e", (p) => b.push(p));
    offA();
    offA();
    bus.publish("e", 1);
    assert.deepEqual(a, []);
    assert.deepEqual(b, [1]);
  });

  it("treats the same function subscribed twice as two subscriptions", () => {
    const bus = new EventBus();
    let n = 0;
    const fn = () => n++;
    const off1 = bus.subscribe("e", fn);
    bus.subscribe("e", fn);
    bus.publish("e");
    assert.equal(n, 2);
    off1();
    bus.publish("e");
    assert.equal(n, 3);
  });

  it("allows a handler to unsubscribe itself during publish", () => {
    const bus = new EventBus();
    let n = 0;
    const off = bus.subscribe("e", () => {
      n++;
      off();
    });
    bus.publish("e");
    bus.publish("e");
    assert.equal(n, 1);
  });

  it("allows a handler to unsubscribe a later handler during publish", () => {
    const bus = new EventBus();
    const calls = [];
    let offSecond;
    bus.subscribe("e", () => {
      calls.push("first");
      offSecond();
    });
    offSecond = bus.subscribe("e", () => calls.push("second"));
    bus.publish("e");
    assert.deepEqual(calls, ["first"]);
  });

  describe('wildcard "*"', () => {
    it("receives every event wrapped as { event, payload }", () => {
      const bus = new EventBus();
      const all = collect(bus, "*");
      bus.publish("a", 1);
      bus.publish("b", { v: 2 });
      assert.deepEqual(all, [
        { event: "a", payload: 1 },
        { event: "b", payload: { v: 2 } },
      ]);
    });

    it("fires for events that have no specific subscribers", () => {
      const bus = new EventBus();
      const all = collect(bus, "*");
      bus.publish("orphan", 1);
      assert.equal(all.length, 1);
    });

    it("runs after specific subscribers", () => {
      const bus = new EventBus();
      const order = [];
      bus.subscribe("*", () => order.push("wildcard"));
      bus.subscribe("a", () => order.push("specific"));
      bus.publish("a");
      assert.deepEqual(order, ["specific", "wildcard"]);
    });

    it("can be unsubscribed", () => {
      const bus = new EventBus();
      const got = [];
      const off = bus.subscribe("*", (p) => got.push(p));
      off();
      bus.publish("a", 1);
      assert.deepEqual(got, []);
    });

    it("does not wrap payloads for specific subscribers", () => {
      const bus = new EventBus();
      const got = collect(bus, "a");
      bus.publish("a", 5);
      assert.deepEqual(got, [5]);
    });
  });

  it("keeps separate state per bus instance", () => {
    const b1 = new EventBus();
    const b2 = new EventBus();
    const got = collect(b2, "a");
    b1.publish("a", 1);
    assert.deepEqual(got, []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  reactive()
// ═════════════════════════════════════════════════════════════════════════════

describe("reactive: basics", () => {
  it("reads initial values", () => {
    const state = reactive({ a: 1, b: "x" }, new EventBus(), {
      scheduler: manualScheduler(),
    });
    assert.equal(state.a, 1);
    assert.equal(state.b, "x");
  });

  it("copies the initial object (no aliasing in either direction)", () => {
    const initial = { a: 1 };
    const state = reactive(initial, new EventBus(), {
      scheduler: manualScheduler(),
    });
    state.a = 2;
    assert.equal(initial.a, 1);
    initial.a = 99;
    assert.equal(state.a, 2);
  });

  it("reflects writes immediately on read, before any event is published", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "a");
    const state = reactive({ a: 0 }, bus, { scheduler: sched });
    state.a = 5;
    assert.equal(state.a, 5);
    assert.equal(events.length, 0);
    sched.run();
    assert.equal(events.length, 1);
  });

  it("publishes { key, value, prev } on the bus under the key name", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "count");
    const state = reactive({ count: 0 }, bus, { scheduler: sched });
    state.count = 7;
    sched.run();
    assert.deepEqual(events, [{ key: "count", value: 7, prev: 0 }]);
  });

  it("supports keys that did not exist initially (prev is undefined)", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "fresh");
    const state = reactive({}, bus, { scheduler: sched });
    state.fresh = 1;
    sched.run();
    assert.deepEqual(events, [{ key: "fresh", value: 1, prev: undefined }]);
  });

  it("does not leak internal bookkeeping keys into the state", () => {
    const sched = manualScheduler();
    const state = reactive({ a: 1 }, new EventBus(), { scheduler: sched });
    state.a = 2;
    sched.run();
    assert.deepEqual(Object.keys(state), ["a"]);
    assert.deepEqual({ ...state }, { a: 2 });
    assert.equal(JSON.stringify(state), '{"a":2}');
  });

  it("stores symbol-keyed properties without publishing", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const all = collect(bus, "*");
    const state = reactive({}, bus, { scheduler: sched });
    const s = Symbol("meta");
    state[s] = 1;
    sched.run();
    assert.equal(state[s], 1);
    assert.equal(all.length, 0);
    assert.equal(sched.calls, 0);
  });
});

describe("reactive: change detection", () => {
  it("ignores writes of an equal primitive", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "a");
    const state = reactive({ a: 1 }, bus, { scheduler: sched });
    state.a = 1;
    assert.equal(sched.calls, 0);
    sched.run();
    assert.equal(events.length, 0);
  });

  it("ignores a new array with identical elements (shallow equality)", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "list");
    const item = { id: 1 };
    const state = reactive({ list: [item] }, bus, { scheduler: sched });
    state.list = [item];
    sched.run();
    assert.equal(events.length, 0);
  });

  it("publishes when an array gains, loses or replaces an element", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "list");
    const state = reactive({ list: [1, 2] }, bus, { scheduler: sched });
    state.list = [...state.list, 3];
    sched.run();
    state.list = state.list.filter((n) => n !== 1);
    sched.run();
    state.list = state.list.map((n) => (n === 2 ? 20 : n));
    sched.run();
    assert.equal(events.length, 3);
    assert.deepEqual(events[2].value, [20, 3]);
  });

  it("does NOT detect in-place mutation (documented limitation)", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "list");
    const state = reactive({ list: [] }, bus, { scheduler: sched });
    state.list.push(1);
    sched.run();
    assert.equal(events.length, 0);
  });

  it("publishes when an object property value changes, ignores equal copies", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "user");
    const state = reactive({ user: { name: "a" } }, bus, { scheduler: sched });
    state.user = { name: "a" };
    sched.run();
    assert.equal(events.length, 0);
    state.user = { name: "b" };
    sched.run();
    assert.equal(events.length, 1);
  });

  it("treats null/undefined/0/'' transitions as real changes", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "v");
    const state = reactive({ v: 0 }, bus, { scheduler: sched });
    for (const next of [null, undefined, "", 0]) {
      state.v = next;
      sched.run();
    }
    assert.equal(events.length, 4);
  });
});

describe("reactive: batching", () => {
  it("coalesces writes to one key into a single event with the latest value", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "x");
    const state = reactive({ x: 0 }, bus, { scheduler: sched });
    state.x = 1;
    state.x = 2;
    state.x = 3;
    sched.run();
    assert.deepEqual(events, [{ key: "x", value: 3, prev: 0 }]);
  });

  it("reports prev as the value at the start of the batch", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "x");
    const state = reactive({ x: "start" }, bus, { scheduler: sched });
    state.x = "mid";
    state.x = "end";
    sched.run();
    assert.equal(events[0].prev, "start");
  });

  it("publishes one event per changed key, in first-write order", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const order = [];
    bus.subscribe("*", ({ event }) => order.push(event));
    const state = reactive({ a: 0, b: 0, c: 0 }, bus, { scheduler: sched });
    state.b = 1;
    state.a = 1;
    state.c = 1;
    state.b = 2;
    sched.run();
    assert.deepEqual(order, ["b", "a", "c"]);
  });

  it("schedules exactly one flush per batch", () => {
    const sched = manualScheduler();
    const state = reactive({ a: 0, b: 0 }, new EventBus(), {
      scheduler: sched,
    });
    state.a = 1;
    state.b = 1;
    state.a = 2;
    assert.equal(sched.calls, 1);
    assert.equal(sched.pending(), 1);
  });

  it("starts a fresh batch after a flush (new prev, new schedule)", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const events = collect(bus, "x");
    const state = reactive({ x: 0 }, bus, { scheduler: sched });
    state.x = 1;
    sched.run();
    state.x = 2;
    assert.equal(sched.calls, 2);
    sched.run();
    assert.deepEqual(events, [
      { key: "x", value: 1, prev: 0 },
      { key: "x", value: 2, prev: 1 },
    ]);
  });

  it("publishes nothing when a key changes and changes back in one batch", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const all = collect(bus, "*");
    const state = reactive({ x: 1 }, bus, { scheduler: sched });
    state.x = 2;
    state.x = 1;
    sched.run();
    assert.equal(all.length, 0);
  });

  it("still publishes other keys when one key reverted", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const all = collect(bus, "*");
    const state = reactive({ x: 1, y: 1 }, bus, { scheduler: sched });
    state.x = 2;
    state.y = 2;
    state.x = 1;
    sched.run();
    assert.deepEqual(
      all.map((e) => e.event),
      ["y"],
    );
  });

  it("queues writes made by handlers during a flush for the next flush", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const state = reactive({ a: 0, b: 0 }, bus, { scheduler: sched });
    bus.subscribe("a", ({ value }) => {
      state.b = value * 10;
    });
    const bEvents = collect(bus, "b");
    state.a = 1;
    sched.run(); // runs both the first and the follow-up flush
    assert.equal(state.b, 10);
    assert.deepEqual(bEvents, [{ key: "b", value: 10, prev: 0 }]);
  });

  it("delivers events to the wildcard with the key as event name", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const all = collect(bus, "*");
    const state = reactive({ a: 0 }, bus, { scheduler: sched });
    state.a = 1;
    sched.run();
    assert.deepEqual(all, [
      { event: "a", payload: { key: "a", value: 1, prev: 0 } },
    ]);
  });
});

describe("reactive: scheduler", () => {
  it("falls back to setTimeout outside a browser (no rAF)", async () => {
    assert.equal(typeof globalThis.requestAnimationFrame, "undefined");
    const bus = new EventBus();
    const events = collect(bus, "a");
    const state = reactive({ a: 0 }, bus); // default scheduler
    state.a = 1;
    assert.equal(events.length, 0);
    await sleep();
    assert.equal(events.length, 1);
  });

  it("uses requestAnimationFrame when it exists at load time", () => {
    const frames = [];
    globalThis.requestAnimationFrame = (fn) => frames.push(fn);
    try {
      const fresh = loadMV();
      const bus = new fresh.EventBus();
      const events = collect(bus, "a");
      const state = fresh.reactive({ a: 0 }, bus);
      state.a = 1;
      state.a = 2;
      assert.equal(frames.length, 1);
      frames[0]();
      assert.deepEqual(events, [{ key: "a", value: 2, prev: 0 }]);
    } finally {
      delete globalThis.requestAnimationFrame;
    }
  });

  it("a custom scheduler overrides the default", () => {
    const sched = manualScheduler();
    const state = reactive({ a: 0 }, new EventBus(), { scheduler: sched });
    state.a = 1;
    assert.equal(sched.calls, 1);
  });
});

describe("reactive: computed values", () => {
  const make = (initial, computed, bus = new EventBus()) => {
    const sched = manualScheduler();
    const state = reactive(initial, bus, { computed, scheduler: sched });
    return { state, bus, sched };
  };

  it("computes initial values at creation", () => {
    const { state } = make({ n: 2 }, { double: (s) => s.n * 2 });
    assert.equal(state.double, 4);
  });

  it("does not publish events or schedule a flush for initial values", () => {
    const bus = new EventBus();
    const all = collect(bus, "*");
    const { sched } = make({ n: 2 }, { double: (s) => s.n * 2 }, bus);
    assert.equal(sched.calls, 0);
    sched.run();
    assert.equal(all.length, 0);
  });

  it("recomputes synchronously after a write", () => {
    const { state } = make({ n: 1 }, { double: (s) => s.n * 2 });
    state.n = 10;
    assert.equal(state.double, 20);
  });

  it("publishes computed changes like any other key", () => {
    const { state, bus, sched } = make({ n: 1 }, { double: (s) => s.n * 2 });
    const events = collect(bus, "double");
    state.n = 5;
    sched.run();
    assert.deepEqual(events, [{ key: "double", value: 10, prev: 2 }]);
  });

  it("publishes a computed key once per batch regardless of write count", () => {
    const { state, bus, sched } = make({ n: 1 }, { double: (s) => s.n * 2 });
    const events = collect(bus, "double");
    state.n = 2;
    state.n = 3;
    state.n = 4;
    sched.run();
    assert.equal(events.length, 1);
    assert.equal(events[0].value, 8);
  });

  it("does not publish when the computed value is unchanged", () => {
    const { state, bus, sched } = make({ n: 1 }, { isOdd: (s) => s.n % 2 === 1 });
    const events = collect(bus, "isOdd");
    state.n = 3;
    sched.run();
    assert.equal(events.length, 0);
    state.n = 4;
    sched.run();
    assert.equal(events.length, 1);
  });

  it("lets later computed keys read earlier ones (declaration order)", () => {
    const { state } = make(
      { n: 2 },
      { double: (s) => s.n * 2, quad: (s) => s.double * 2 },
    );
    assert.equal(state.quad, 8);
    state.n = 5;
    assert.equal(state.quad, 20);
  });

  it("recomputes a computed array only when its contents change", () => {
    const { state, bus, sched } = make(
      { items: [1, 2, 3], filter: "all" },
      { visible: (s) => [...s.items] },
    );
    const events = collect(bus, "visible");
    state.filter = "all"; // no-op write
    state.filter = "other"; // recompute yields an equal array
    sched.run();
    assert.equal(events.length, 0);
    state.items = [...state.items, 4];
    sched.run();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].value, [1, 2, 3, 4]);
  });

  it("throws when a computed key is assigned", () => {
    const { state } = make({ n: 1 }, { double: (s) => s.n * 2 });
    assert.throws(() => {
      state.double = 5;
    }, /computed/);
    assert.equal(state.double, 2);
  });

  it("works with several independent computed keys", () => {
    const { state } = make(
      { a: 1, b: 2 },
      { sum: (s) => s.a + s.b, product: (s) => s.a * s.b },
    );
    state.a = 3;
    assert.equal(state.sum, 5);
    assert.equal(state.product, 6);
  });

  it("allows state keys named like Object.prototype members", () => {
    const { state } = make({ n: 1 }, { double: (s) => s.n * 2 });
    assert.doesNotThrow(() => {
      state.toString = "custom";
      state.constructor = "also custom";
    });
    assert.equal(state.toString, "custom");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  bind()
// ═════════════════════════════════════════════════════════════════════════════

describe("bind", () => {
  it("sets textContent on non-form elements when the key changes", () => {
    const bus = new EventBus();
    const el = new FakeNode();
    bind(bus, "count", el);
    bus.publish("count", { value: 7 });
    assert.equal(el.textContent, 7);
  });

  it("sets .value on <input>, <select> and <textarea>", () => {
    const bus = new EventBus();
    const els = [
      new HTMLInputElement(),
      new HTMLSelectElement(),
      new HTMLTextAreaElement(),
    ];
    els.forEach((el) => bind(bus, "k", el));
    bus.publish("k", { value: "hello" });
    for (const el of els) {
      assert.equal(el.value, "hello");
      assert.equal(el.textContent, "");
    }
  });

  it("applies the transform", () => {
    const bus = new EventBus();
    const el = new FakeNode();
    bind(bus, "pct", el, (v) => `${v}%`);
    bus.publish("pct", { value: 40 });
    assert.equal(el.textContent, "40%");
  });

  it("uses an identity transform by default", () => {
    const bus = new EventBus();
    const el = new HTMLInputElement();
    bind(bus, "k", el);
    bus.publish("k", { value: "same" });
    assert.equal(el.value, "same");
  });

  it("does not paint the initial value (that is View.bind's job)", () => {
    const bus = new EventBus();
    const el = new FakeNode();
    el.textContent = "initial";
    bind(bus, "k", el);
    assert.equal(el.textContent, "initial");
  });

  it("resolves CSS selector strings via document.querySelector", () => {
    const bus = new EventBus();
    const el = mount("#out", new FakeNode());
    bind(bus, "k", "#out");
    bus.publish("k", { value: "via selector" });
    assert.equal(el.textContent, "via selector");
  });

  it("returns a no-op unbind when the selector matches nothing", () => {
    const bus = new EventBus();
    const off = bind(bus, "k", "#missing");
    assert.equal(typeof off, "function");
    assert.doesNotThrow(() => off());
    assert.doesNotThrow(() => bus.publish("k", { value: 1 }));
  });

  it("returns a no-op unbind when given null", () => {
    const off = bind(new EventBus(), "k", null);
    assert.equal(typeof off, "function");
  });

  it("unbind stops further updates", () => {
    const bus = new EventBus();
    const el = new FakeNode();
    const off = bind(bus, "k", el);
    bus.publish("k", { value: 1 });
    off();
    bus.publish("k", { value: 2 });
    assert.equal(el.textContent, 1);
  });

  it("binds several elements to the same key independently", () => {
    const bus = new EventBus();
    const a = new FakeNode();
    const b = new FakeNode();
    bind(bus, "k", a, (v) => `a${v}`);
    bind(bus, "k", b, (v) => `b${v}`);
    bus.publish("k", { value: 1 });
    assert.equal(a.textContent, "a1");
    assert.equal(b.textContent, "b1");
  });

  describe("garbage-collected elements", () => {
    let RealWeakRef;
    beforeEach(() => {
      RealWeakRef = globalThis.WeakRef;
    });
    afterEach(() => {
      globalThis.WeakRef = RealWeakRef;
    });

    it("unsubscribes itself once the element has been collected", () => {
      globalThis.WeakRef = class {
        deref() {
          return undefined; // simulate GC
        }
      };
      const bus = new EventBus();
      let hits = 0;
      bind(bus, "k", new FakeNode());
      bus.subscribe("k", () => hits++); // a sibling subscriber, unaffected
      bus.publish("k", { value: 1 });
      assert.equal(bus._subs.get("k").size, 1, "bind subscription removed");
      bus.publish("k", { value: 2 });
      assert.equal(hits, 2);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  twoWayBind()
// ═════════════════════════════════════════════════════════════════════════════

describe("twoWayBind", () => {
  const setup = (coerce) => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const state = reactive({ name: "" }, bus, { scheduler: sched });
    const el = new HTMLInputElement();
    const off = twoWayBind(bus, state, "name", el, coerce);
    return { sched, bus, state, el, off };
  };

  it("writes input events into state", () => {
    const { state, el } = setup();
    el.value = "Ada";
    el.dispatch("input");
    assert.equal(state.name, "Ada");
  });

  it("applies coerce to the value written to state", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const state = reactive({ age: 0 }, bus, { scheduler: sched });
    const el = new HTMLInputElement();
    twoWayBind(bus, state, "age", el, Number);
    el.value = "42";
    el.dispatch("input");
    assert.strictEqual(state.age, 42);
  });

  it("pushes state changes back into the field", () => {
    const { state, el, sched } = setup();
    state.name = "Grace";
    sched.run();
    assert.equal(el.value, "Grace");
  });

  it("round-trips: typing then flushing leaves the field consistent", () => {
    const { state, el, sched } = setup();
    el.value = "typed";
    el.dispatch("input");
    sched.run();
    assert.equal(el.value, "typed");
    assert.equal(state.name, "typed");
  });

  it("resolves a selector string", () => {
    const sched = manualScheduler();
    const bus = new EventBus();
    const state = reactive({ q: "" }, bus, { scheduler: sched });
    const el = mount("#q", new HTMLInputElement());
    twoWayBind(bus, state, "q", "#q");
    el.value = "search";
    el.dispatch("input");
    assert.equal(state.q, "search");
  });

  it("returns a no-op when the element is missing", () => {
    const bus = new EventBus();
    const state = reactive({ q: "" }, bus, { scheduler: manualScheduler() });
    const off = twoWayBind(bus, state, "q", "#nope");
    assert.equal(typeof off, "function");
    assert.doesNotThrow(() => off());
  });

  it("unbind removes the DOM listener and the bus subscription", () => {
    const { state, el, sched, off } = setup();
    assert.equal(el.listenerCount("input"), 1);
    off();
    assert.equal(el.listenerCount("input"), 0);
    el.value = "ignored";
    el.dispatch("input");
    assert.equal(state.name, "");
    state.name = "later";
    sched.run();
    assert.equal(el.value, "ignored", "no write-back after unbind");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Model
// ═════════════════════════════════════════════════════════════════════════════

describe("Model", () => {
  it("creates a bus and reactive state", () => {
    const m = new Model({ a: 1 }, { scheduler: manualScheduler() });
    assert.ok(m.bus instanceof EventBus);
    assert.equal(m.state.a, 1);
  });

  it("defaults to empty state with no arguments", () => {
    const m = new Model();
    assert.deepEqual({ ...m.state }, {});
  });

  it("gives every instance its own bus and state", () => {
    const sched = manualScheduler();
    const m1 = new Model({ a: 1 }, { scheduler: sched });
    const m2 = new Model({ a: 1 }, { scheduler: sched });
    assert.notEqual(m1.bus, m2.bus);
    const seen = collect(m2.bus, "a");
    m1.state.a = 2;
    sched.run();
    assert.equal(m2.state.a, 1);
    assert.equal(seen.length, 0);
  });

  it("passes computed and scheduler options through to reactive()", () => {
    const sched = manualScheduler();
    const m = new Model(
      { n: 3 },
      { computed: { sq: (s) => s.n * s.n }, scheduler: sched },
    );
    assert.equal(m.state.sq, 9);
    m.state.n = 4;
    assert.equal(sched.calls, 1);
    assert.equal(m.state.sq, 16);
  });

  it("on() subscribes to the model bus and returns an unsubscribe", () => {
    const sched = manualScheduler();
    const m = new Model({ a: 0 }, { scheduler: sched });
    const seen = [];
    const off = m.on("a", (p) => seen.push(p.value));
    m.state.a = 1;
    sched.run();
    off();
    m.state.a = 2;
    sched.run();
    assert.deepEqual(seen, [1]);
  });

  it("on('*') observes every state key", () => {
    const sched = manualScheduler();
    const m = new Model({ a: 0, b: 0 }, { scheduler: sched });
    const seen = [];
    m.on("*", ({ event }) => seen.push(event));
    m.state.a = 1;
    m.state.b = 1;
    sched.run();
    assert.deepEqual(seen, ["a", "b"]);
  });

  it("supports subclasses with command methods", () => {
    class Counter extends Model {
      constructor() {
        super(
          { count: 0 },
          { computed: { isEven: (s) => s.count % 2 === 0 }, scheduler },
        );
      }
      increment() {
        this.state.count++;
      }
    }
    const scheduler = manualScheduler();
    const c = new Counter();
    assert.equal(c.state.isEven, true);
    c.increment();
    c.increment();
    c.increment();
    assert.equal(c.state.count, 3);
    assert.equal(c.state.isEven, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  View
// ═════════════════════════════════════════════════════════════════════════════

describe("View", () => {
  const setup = () => {
    const sched = manualScheduler();
    const model = new Model({ count: 0, name: "init" }, { scheduler: sched });
    return { sched, model };
  };

  describe("abstract methods", () => {
    it("render() throws, naming the subclass", () => {
      class Foo extends View {}
      const { model } = setup();
      assert.throws(
        () => new Foo(model.bus, model.state).render(),
        /Foo must implement render\(\)/,
      );
    });

    it("bindEvents() throws, naming the subclass", () => {
      class Bar extends View {}
      const { model } = setup();
      assert.throws(
        () => new Bar(model.bus, model.state).bindEvents(),
        /Bar must implement bindEvents\(\)/,
      );
    });

    it("mount() surfaces the abstract-method error", () => {
      class Baz extends View {}
      const { model } = setup();
      assert.throws(() => new Baz(model.bus, model.state).mount(), /render/);
    });
  });

  describe("lifecycle", () => {
    class Probe extends View {
      constructor(...args) {
        super(...args);
        this.calls = [];
      }
      render() {
        this.calls.push("render");
      }
      bindEvents() {
        this.calls.push("bindEvents");
      }
    }

    it("stores constructor arguments", () => {
      const { model } = setup();
      const root = new FakeNode();
      const v = new Probe(model.bus, model.state, root);
      assert.equal(v._bus, model.bus);
      assert.equal(v._state, model.state);
      assert.equal(v._root, root);
    });

    it("root defaults to null", () => {
      const { model } = setup();
      assert.equal(new Probe(model.bus, model.state)._root, null);
    });

    it("mount() calls render() then bindEvents()", () => {
      const { model } = setup();
      const v = new Probe(model.bus, model.state);
      v.mount();
      assert.deepEqual(v.calls, ["render", "bindEvents"]);
    });

    it("mount() is idempotent and chainable", () => {
      const { model } = setup();
      const v = new Probe(model.bus, model.state);
      assert.equal(v.mount(), v);
      v.mount();
      v.mount();
      assert.deepEqual(v.calls, ["render", "bindEvents"]);
    });

    it("can be mounted again after destroy()", () => {
      const { model } = setup();
      const v = new Probe(model.bus, model.state);
      v.mount();
      v.destroy();
      v.mount();
      assert.deepEqual(v.calls, ["render", "bindEvents", "render", "bindEvents"]);
    });

    it("destroy() on a never-mounted view is harmless", () => {
      const { model } = setup();
      assert.doesNotThrow(() => new Probe(model.bus, model.state).destroy());
    });
  });

  describe("subscribe()", () => {
    it("subscribes to the model bus and returns an unsubscribe", () => {
      const { model, sched } = setup();
      const v = new View(model.bus, model.state);
      const seen = [];
      const off = v.subscribe("count", (p) => seen.push(p.value));
      model.state.count = 1;
      sched.run();
      off();
      model.state.count = 2;
      sched.run();
      assert.deepEqual(seen, [1]);
    });

    it("is torn down by destroy()", () => {
      const { model, sched } = setup();
      const v = new View(model.bus, model.state);
      const seen = [];
      v.subscribe("count", (p) => seen.push(p.value));
      v.destroy();
      model.state.count = 5;
      sched.run();
      assert.deepEqual(seen, []);
    });
  });

  describe("bind()", () => {
    it("paints the current state value immediately", () => {
      const { model } = setup();
      const el = new FakeNode();
      new View(model.bus, model.state).bind("count", el);
      assert.equal(el.textContent, 0);
    });

    it("applies the transform to the initial paint and to updates", () => {
      const { model, sched } = setup();
      const el = new FakeNode();
      new View(model.bus, model.state).bind("count", el, (v) => `#${v}`);
      assert.equal(el.textContent, "#0");
      model.state.count = 3;
      sched.run();
      assert.equal(el.textContent, "#3");
    });

    it("writes .value for form fields", () => {
      const { model, sched } = setup();
      const input = new HTMLInputElement();
      new View(model.bus, model.state).bind("name", input);
      assert.equal(input.value, "init");
      model.state.name = "next";
      sched.run();
      assert.equal(input.value, "next");
    });

    it("accepts a selector string", () => {
      const { model } = setup();
      const el = mount("#c", new FakeNode());
      new View(model.bus, model.state).bind("count", "#c", String);
      assert.equal(el.textContent, "0");
    });

    it("skips the initial paint for keys missing from state", () => {
      const { model } = setup();
      const el = new FakeNode();
      el.textContent = "keep";
      new View(model.bus, model.state).bind("nope", el);
      assert.equal(el.textContent, "keep");
    });

    it("tolerates a selector that matches nothing", () => {
      const { model } = setup();
      const v = new View(model.bus, model.state);
      assert.doesNotThrow(() => v.bind("count", "#absent"));
      assert.doesNotThrow(() => v.destroy());
    });

    it("returns an unbind function", () => {
      const { model, sched } = setup();
      const el = new FakeNode();
      const off = new View(model.bus, model.state).bind("count", el);
      off();
      model.state.count = 9;
      sched.run();
      assert.equal(el.textContent, 0);
    });

    it("stops updating after destroy()", () => {
      const { model, sched } = setup();
      const el = new FakeNode();
      const v = new View(model.bus, model.state);
      v.bind("count", el);
      v.destroy();
      model.state.count = 4;
      sched.run();
      assert.equal(el.textContent, 0);
    });
  });

  describe("twoWayBind()", () => {
    it("paints the current value, then syncs both directions", () => {
      const { model, sched } = setup();
      const input = new HTMLInputElement();
      new View(model.bus, model.state).twoWayBind(model.state, "name", input);
      assert.equal(input.value, "init");

      input.value = "typed";
      input.dispatch("input");
      assert.equal(model.state.name, "typed");

      model.state.name = "programmatic";
      sched.run();
      assert.equal(input.value, "programmatic");
    });

    it("applies coerce", () => {
      const { model } = setup();
      const input = new HTMLInputElement();
      new View(model.bus, model.state).twoWayBind(
        model.state,
        "count",
        input,
        Number,
      );
      input.value = "12";
      input.dispatch("input");
      assert.strictEqual(model.state.count, 12);
    });

    it("is torn down by destroy()", () => {
      const { model } = setup();
      const input = new HTMLInputElement();
      const v = new View(model.bus, model.state);
      v.twoWayBind(model.state, "name", input);
      assert.equal(input.listenerCount("input"), 1);
      v.destroy();
      assert.equal(input.listenerCount("input"), 0);
    });
  });

  describe("on()", () => {
    it("attaches a DOM listener", () => {
      const { model } = setup();
      const el = new FakeNode();
      let clicks = 0;
      new View(model.bus, model.state).on(el, "click", () => clicks++);
      el.dispatch("click");
      el.dispatch("click");
      assert.equal(clicks, 2);
    });

    it("returns an off function that detaches only that listener", () => {
      const { model } = setup();
      const el = new FakeNode();
      const calls = [];
      const v = new View(model.bus, model.state);
      const off = v.on(el, "click", () => calls.push("a"));
      v.on(el, "click", () => calls.push("b"));
      off();
      el.dispatch("click");
      assert.deepEqual(calls, ["b"]);
    });

    it("forwards listener options and removes with the same options", () => {
      const { model } = setup();
      const el = new FakeNode();
      const opts = { passive: true };
      const v = new View(model.bus, model.state);
      v.on(el, "scroll", () => {}, opts);
      assert.deepEqual(el.listenerOptions("scroll"), [opts]);
      v.destroy();
      assert.equal(el.listenerCount("scroll"), 0);
    });

    it("removes every listener on destroy()", () => {
      const { model } = setup();
      const a = new FakeNode();
      const b = new FakeNode();
      const v = new View(model.bus, model.state);
      v.on(a, "click", () => {});
      v.on(a, "keydown", () => {});
      v.on(b, "click", () => {});
      v.destroy();
      assert.equal(a.listenerCount("click"), 0);
      assert.equal(a.listenerCount("keydown"), 0);
      assert.equal(b.listenerCount("click"), 0);
    });
  });

  describe("destroy()", () => {
    it("tears down every kind of registration at once", () => {
      const { model, sched } = setup();
      const label = new FakeNode();
      const input = new HTMLInputElement();
      const button = new FakeNode();
      const seen = [];
      const v = new View(model.bus, model.state);
      v.subscribe("count", (p) => seen.push(p.value));
      v.bind("count", label);
      v.twoWayBind(model.state, "name", input);
      v.on(button, "click", () => seen.push("click"));

      v.destroy();

      model.state.count = 1;
      sched.run();
      button.dispatch("click");
      input.value = "x";
      input.dispatch("input");

      assert.deepEqual(seen, []);
      assert.equal(label.textContent, 0);
      assert.equal(model.state.name, "init");
    });

    it("is idempotent", () => {
      const { model } = setup();
      const v = new View(model.bus, model.state);
      v.on(new FakeNode(), "click", () => {});
      v.destroy();
      assert.doesNotThrow(() => v.destroy());
    });

    it("does not affect other views on the same model", () => {
      const { model, sched } = setup();
      const a = new View(model.bus, model.state);
      const b = new View(model.bus, model.state);
      const seenA = [];
      const seenB = [];
      a.subscribe("count", (p) => seenA.push(p.value));
      b.subscribe("count", (p) => seenB.push(p.value));
      a.destroy();
      model.state.count = 1;
      sched.run();
      assert.deepEqual(seenA, []);
      assert.deepEqual(seenB, [1]);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Integration: the task-manager pattern (Model + two Views on one bus)
// ═════════════════════════════════════════════════════════════════════════════

describe("integration: task manager", () => {
  class TaskModel extends Model {
    constructor(scheduler) {
      super(
        { tasks: [], filter: "all" },
        {
          scheduler,
          computed: {
            total: (s) => s.tasks.length,
            done: (s) => s.tasks.filter((t) => t.done).length,
            active: (s) => s.total - s.done,
            high: (s) =>
              s.tasks.filter((t) => t.priority === "high" && !t.done).length,
            pct: (s) => (s.total ? Math.round((s.done / s.total) * 100) : 0),
            visible: (s) => {
              switch (s.filter) {
                case "active":
                  return s.tasks.filter((t) => !t.done);
                case "done":
                  return s.tasks.filter((t) => t.done);
                case "high":
                  return s.tasks.filter((t) => t.priority === "high");
                default:
                  return [...s.tasks];
              }
            },
          },
        },
      );
      this._nextId = 1;
    }
    addTask(title, priority = "medium") {
      if (!title.trim()) return;
      this.state.tasks = [
        ...this.state.tasks,
        { id: this._nextId++, title: title.trim(), priority, done: false },
      ];
    }
    toggleTask(id) {
      this.state.tasks = this.state.tasks.map((t) =>
        t.id === id ? { ...t, done: !t.done } : t,
      );
    }
    deleteTask(id) {
      this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
    }
    setFilter(f) {
      this.state.filter = f;
    }
  }

  class StatsView extends View {
    constructor(bus, state, els) {
      super(bus, state);
      this.els = els;
    }
    render() {}
    bindEvents() {
      this.bind("total", this.els.total, String);
      this.bind("done", this.els.done, String);
      this.bind("pct", this.els.pct, (v) => `${v}%`);
    }
  }

  class ListView extends View {
    constructor(bus, state) {
      super(bus, state);
      this.renders = [];
    }
    render() {
      this.renders.push(this._state.visible.map((t) => t.title));
    }
    bindEvents() {
      this.subscribe("visible", ({ value }) =>
        this.renders.push(value.map((t) => t.title)),
      );
    }
  }

  const build = () => {
    const sched = manualScheduler();
    const model = new TaskModel(sched);
    const els = {
      total: new FakeNode(),
      done: new FakeNode(),
      pct: new FakeNode(),
    };
    const stats = new StatsView(model.bus, model.state, els).mount();
    const list = new ListView(model.bus, model.state).mount();
    const log = [];
    model.on("*", ({ event }) => log.push(event));
    return { sched, model, els, stats, list, log };
  };

  it("starts empty with zeroed stats painted by the view", () => {
    const { els, list } = build();
    assert.equal(els.total.textContent, "0");
    assert.equal(els.pct.textContent, "0%");
    assert.deepEqual(list.renders, [[]]);
  });

  it("updates stats and the visible list after commands", () => {
    const { model, sched, els, list } = build();
    model.addTask("write tests", "high");
    model.addTask("ship it");
    sched.run();
    assert.equal(els.total.textContent, "2");
    assert.equal(model.state.high, 1);
    assert.deepEqual(list.renders.at(-1), ["write tests", "ship it"]);

    model.toggleTask(1);
    sched.run();
    assert.equal(els.done.textContent, "1");
    assert.equal(els.pct.textContent, "50%");
    assert.equal(model.state.high, 0, "completed high task no longer counts");
  });

  it("rejects blank titles and trims whitespace", () => {
    const { model, sched } = build();
    model.addTask("   ");
    model.addTask("  padded  ");
    sched.run();
    assert.equal(model.state.total, 1);
    assert.equal(model.state.tasks[0].title, "padded");
  });

  it("filters: active, done, high and all", () => {
    const { model } = build();
    model.addTask("a", "high");
    model.addTask("b", "low");
    model.addTask("c", "high");
    model.toggleTask(1);
    const titles = () => model.state.visible.map((t) => t.title);

    model.setFilter("active");
    assert.deepEqual(titles(), ["b", "c"]);
    model.setFilter("done");
    assert.deepEqual(titles(), ["a"]);
    model.setFilter("high");
    assert.deepEqual(titles(), ["a", "c"]);
    model.setFilter("all");
    assert.deepEqual(titles(), ["a", "b", "c"]);
  });

  it("deleting a task updates totals and the list", () => {
    const { model, sched, list } = build();
    model.addTask("a");
    model.addTask("b");
    sched.run();
    model.deleteTask(1);
    sched.run();
    assert.equal(model.state.total, 1);
    assert.deepEqual(list.renders.at(-1), ["b"]);
  });

  it("a burst of commands yields one render per frame, not one per command", () => {
    const { model, sched, list } = build();
    const before = list.renders.length;
    model.addTask("a");
    model.addTask("b");
    model.addTask("c");
    sched.run();
    assert.equal(list.renders.length - before, 1);
    assert.deepEqual(list.renders.at(-1), ["a", "b", "c"]);
  });

  it("changing only the filter republishes `filter` and `visible`, not the stats", () => {
    const { model, sched, log } = build();
    model.addTask("a");
    model.addTask("b");
    model.toggleTask(1);
    sched.run();
    log.length = 0;
    model.setFilter("done");
    sched.run();
    assert.deepEqual(log.sort(), ["filter", "visible"]);
  });

  it("wildcard log sees every changed key exactly once per frame", () => {
    const { model, sched, log } = build();
    model.addTask("a");
    sched.run();
    const counts = log.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
    assert.ok(Object.values(counts).every((n) => n === 1));
    assert.ok("tasks" in counts && "total" in counts && "visible" in counts);
  });

  it("destroyed views stop reacting while the model keeps working", () => {
    const { model, sched, els, stats } = build();
    model.addTask("a");
    sched.run();
    stats.destroy();
    model.addTask("b");
    sched.run();
    assert.equal(els.total.textContent, "1", "stale: view was destroyed");
    assert.equal(model.state.total, 2, "model unaffected");
  });
});
