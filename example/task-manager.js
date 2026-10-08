"use strict";

// ═══════════════════════════════════════════════════════════════════════════
//  Task Manager — example app built on MV (see ../API.md)
// ═══════════════════════════════════════════════════════════════════════════

const { Model, View, escapeHtml, summarise } = MV;

// ── Model ───────────────────────────────────────────────────────────────────
// State + business rules. No DOM. Derived values are declared as `computed`,
// so every command only has to change tasks / filter.

class TaskModel extends Model {
  constructor() {
    super(
      { tasks: [], filter: "all" },
      {
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
    this.addTask("Read through the MV architecture code", "high");
    this.addTask("Wire up a second view to the same model", "medium");
    this.addTask("Write tests for EventBus.subscribe", "low");
  }

  addTask(title, priority = "medium") {
    if (!title.trim()) return;
    const task = {
      id: this._nextId++,
      title: title.trim(),
      priority,
      done: false,
      created: Date.now(),
    };
    this.state.tasks = [...this.state.tasks, task];
  }

  toggleTask(id) {
    this.state.tasks = this.state.tasks.map((t) =>
      t.id === id ? { ...t, done: !t.done } : t,
    );
  }

  deleteTask(id) {
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
  }

  setFilter(filter) {
    this.state.filter = filter;
  }
}

// ── TaskView ────────────────────────────────────────────────────────────────
// Knows the HTML; delegates every mutation to injected callbacks.

class TaskView extends View {
  constructor(bus, state, callbacks) {
    super(bus, state, document.getElementById("task-list"));
    this._cb = callbacks;
    this._elList = document.getElementById("task-list");
    this._elTitle = document.getElementById("inp-title");
    this._elPrio = document.getElementById("inp-priority");
    this._elBtnAdd = document.getElementById("btn-add");
    this._elFilters = document.querySelectorAll(".filter-btn");
    this._elBar = document.getElementById("stat-bar");
  }

  render() {
    this._renderList(this._state.visible);
    this._elBar.style.width = `${this._state.pct}%`;
    this._syncFilters(this._state.filter);
  }

  bindEvents() {
    // Model → View
    this.subscribe("visible", ({ value }) => this._renderList(value));
    this.subscribe("filter", ({ value }) => this._syncFilters(value));
    this.subscribe("pct", ({ value }) => {
      this._elBar.style.width = `${value}%`;
    });

    // Stat counters: bind() paints the current value and keeps it in sync
    this.bind("total", "#stat-total", String);
    this.bind("done", "#stat-done", String);
    this.bind("active", "#stat-active", String);
    this.bind("high", "#stat-high", String);
    this.bind("pct", "#stat-pct", (v) => `${v}%`);

    // View → Model
    this.on(this._elBtnAdd, "click", () => {
      this._cb.onAdd(this._elTitle.value, this._elPrio.value);
      this._elTitle.value = "";
      this._elTitle.focus();
    });
    this.on(this._elTitle, "keydown", (e) => {
      if (e.key === "Enter") this._elBtnAdd.click();
    });
    this._elFilters.forEach((btn) =>
      this.on(btn, "click", () => this._cb.onFilter(btn.dataset.filter)),
    );

    // Event delegation: one listener serves every (re-rendered) item
    this.on(this._elList, "click", (e) => {
      const item = e.target.closest("[data-id]");
      if (!item) return;
      const id = Number(item.dataset.id);
      if (e.target.closest(".task-check")) this._cb.onToggle(id);
      if (e.target.closest(".task-delete")) this._cb.onDelete(id);
    });
  }

  _syncFilters(value) {
    this._elFilters.forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.filter === value),
    );
  }

  _renderList(tasks) {
    if (!tasks.length) {
      this._elList.innerHTML = `<div class="empty-state">No tasks here — add one above.</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const task of tasks) {
      const item = document.createElement("div");
      item.className = `task-item${task.done ? " done" : ""}`;
      item.dataset.id = task.id;
      item.innerHTML = `
<div class="task-check" title="Toggle done">
<svg width="10" height="8" viewBox="0 0 10 8" fill="none">
<path d="M1 4l3 3 5-6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
</div>
<span class="task-title">${escapeHtml(task.title)}</span>
<span class="task-priority priority-${task.priority}">${task.priority}</span>
<button class="btn btn-icon task-delete btn-danger" title="Delete task" style="opacity:.6">✕</button>
`;
      frag.appendChild(item);
    }
    this._elList.replaceChildren(frag);
  }
}

// ── LogView ─────────────────────────────────────────────────────────────────
// A second, independent view on the same bus, using the "*" wildcard.

class LogView extends View {
  constructor(bus, state) {
    super(bus, state, document.getElementById("mv-log"));
    this._elLog = document.getElementById("mv-log");
    this._elClear = document.getElementById("btn-clear-log");
    this._empty = this._elLog.querySelector(".log-empty");
  }

  render() {}

  bindEvents() {
    this.subscribe("*", ({ event, payload }) => {
      if (!this._elLog.offsetParent) return;
      const layer = event === "filter" ? "view" : "model";
      const entry = document.createElement("div");
      entry.className = "log-row";
      entry.innerHTML = `
<span class="log-ts">${new Date().toLocaleTimeString("en", { hour12: false })}</span>
<span class="log-layer ${layer}">${layer}</span>
<span class="log-msg">${event} &rarr; ${escapeHtml(summarise(payload.value))}</span>
`;
      if (this._empty?.parentNode) this._empty.remove();
      this._elLog.prepend(entry);
      requestAnimationFrame(() => entry.classList.add("in"));
      if (this._elLog.children.length > 50)
        this._elLog.removeChild(this._elLog.lastChild);
    });

    this.on(this._elClear, "click", () => {
      this._elLog.innerHTML = '<span class="log-empty">— no events yet —</span>';
      this._empty = this._elLog.querySelector(".log-empty");
    });
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

const model = new TaskModel();

const taskView = new TaskView(model.bus, model.state, {
  onAdd: (title, priority) => model.addTask(title, priority),
  onToggle: (id) => model.toggleTask(id),
  onDelete: (id) => model.deleteTask(id),
  onFilter: (filter) => model.setFilter(filter),
}).mount();

const logView = new LogView(model.bus, model.state).mount();
