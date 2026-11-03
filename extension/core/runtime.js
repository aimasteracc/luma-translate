// Shared by the module service worker and classic isolated-world content scripts.
if (!globalThis.LumaRuntime) globalThis.LumaRuntime = class PluginRuntime {
  constructor() {
    this.plugins = new Map();
    this.services = new Map();
    this.serviceOwners = new Map();
    this.events = new Map();
    this.disabled = new Set();
    this.mountSequence = 0;
  }

  register(plugin) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(plugin.id) || typeof plugin.setup !== "function") throw new Error("Invalid plugin descriptor");
    if (this.plugins.has(plugin.id)) throw new Error(`Duplicate plugin: ${plugin.id}`);
    this.plugins.set(plugin.id, { plugin, state: "disabled", cleanups: [] });
    return this;
  }

  get(name) {
    if (!this.services.has(name)) throw new Error(`Missing service: ${name}`);
    return this.services.get(name);
  }

  emit(name, value) {
    for (const handler of this.events.get(name) || []) handler(value);
  }

  dispose(entry) {
    for (const cleanup of entry.cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { entry.error = error.message; }
    }
    entry.state = "disabled";
  }

  configure(disabled = []) {
    this.disabled = new Set(disabled);
    // Unwind dependents first, then providers, including transitive dependencies.
    const removed = new Set([...this.plugins.values()].filter(e => e.state === "active" && this.disabled.has(e.plugin.id)).map(e => e.plugin.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of this.plugins.values()) {
        if (entry.state !== "active" || removed.has(entry.plugin.id)) continue;
        if ((entry.plugin.inject || []).some(name => removed.has(this.serviceOwners.get(name)))) {
          removed.add(entry.plugin.id);
          changed = true;
        }
      }
    }
    for (const entry of [...this.plugins.values()].sort((a, b) => (b.mountedAt || 0) - (a.mountedAt || 0))) {
      if (removed.has(entry.plugin.id) && entry.state === "active") this.dispose(entry);
    }
    for (const entry of this.plugins.values()) {
      if (entry.state !== "active") {
        entry.state = this.disabled.has(entry.plugin.id) ? "disabled" : "blocked";
        entry.error = "";
      }
    }
    // Topological mounting also supports plugins registered before their providers.
    do {
      changed = false;
      for (const entry of this.plugins.values()) {
        const { plugin } = entry;
        if (entry.state !== "blocked" || (plugin.inject || []).some(name => !this.services.has(name))) continue;
        const effect = cleanup => { entry.cleanups.push(cleanup); return cleanup; };
        const controller = new AbortController();
        effect(() => controller.abort());
        const context = {
          signal: controller.signal,
          get: name => {
            if (!(plugin.inject || []).includes(name)) throw new Error(`Undeclared dependency: ${name}`);
            return this.get(name);
          },
          effect,
          provide: (name, value) => {
            if (!(plugin.provides || []).includes(name)) throw new Error(`Undeclared service: ${name}`);
            if (this.services.has(name)) throw new Error(`Duplicate service: ${name}`);
            this.services.set(name, value);
            this.serviceOwners.set(name, plugin.id);
            effect(() => { this.services.delete(name); this.serviceOwners.delete(name); });
          },
          on: (name, handler) => {
            if (!this.events.has(name)) this.events.set(name, new Set());
            this.events.get(name).add(handler);
            effect(() => this.events.get(name).delete(handler));
          },
          listen: (target, name, handler, options) => {
            target.addEventListener(name, handler, options);
            effect(() => target.removeEventListener(name, handler, options));
          },
        };
        try {
          const cleanup = plugin.setup(context);
          if (typeof cleanup === "function") effect(cleanup);
          for (const name of plugin.provides || []) {
            if (!this.services.has(name)) throw new Error(`Service was not provided: ${name}`);
          }
          entry.state = "active";
          entry.mountedAt = ++this.mountSequence;
        } catch (error) {
          this.dispose(entry);
          entry.state = "error";
          entry.error = error.message;
        }
        changed = true;
      }
    } while (changed);
    return this.list();
  }

  list() {
    return [...this.plugins.values()].map(({ plugin, state, error }) => ({
      id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "1.0.0",
      description: plugin.description || "", inject: plugin.inject || [],
      provides: plugin.provides || [], state,
      enabled: !this.disabled.has(plugin.id),
      error: error || (state === "blocked" ? `Missing: ${(plugin.inject || []).filter(name => !this.services.has(name)).join(", ")}` : ""),
    }));
  }
};
