import test from "node:test";
import assert from "node:assert/strict";
import "../extension/core/runtime.js";
import { createBackgroundRuntime } from "../extension/core/background-plugins.js";
import { DEFAULTS } from "../extension/core/config.js";

test("dependencies mount in order, unload in reverse, and recover without duplicate effects", () => {
  const runtime = new globalThis.LumaRuntime();
  const events = [];
  runtime.register({
    id: "consumer", inject: ["service"],
    setup(ctx) {
      assert.equal(ctx.get("service"), 42);
      ctx.on("event", value => events.push(value));
      return () => { assert.equal(ctx.get("service"), 42); events.push("dispose-consumer"); };
    },
  }).register({
    id: "provider", provides: ["service"],
    setup(ctx) { ctx.provide("service", 42); return () => events.push("dispose-provider"); },
  });
  runtime.configure();
  runtime.configure();
  runtime.emit("event", "one");
  assert.deepEqual(events, ["one"]);
  runtime.configure(["provider"]);
  assert.equal(runtime.list()[0].state, "blocked");
  assert.throws(() => runtime.get("service"));
  runtime.emit("event", "should-not-run");
  assert.deepEqual(events, ["one", "dispose-consumer", "dispose-provider"]);
  runtime.configure();
  runtime.emit("event", "two");
  assert.equal(events.at(-1), "two");
  assert.equal(runtime.list()[0].state, "active");
});

test("failed plugin mount rolls back services and listeners; unknown dependencies stay blocked", () => {
  const runtime = new globalThis.LumaRuntime();
  runtime.register({
    id: "broken", provides: ["partial"],
    setup(ctx) {
      ctx.provide("partial", {});
      ctx.on("event", () => assert.fail("leaked hook"));
      throw new Error("setup failed");
    },
  }).register({ id: "dependent", inject: ["partial"], setup() { assert.fail("mounted without dependency"); } });
  runtime.configure();
  assert.equal(runtime.list()[0].state, "error");
  assert.equal(runtime.list()[1].state, "blocked");
  assert.throws(() => runtime.get("partial"));
  runtime.emit("event");
});

test("disabling prompt plugins removes their actual instructions and providers can be replaced", () => {
  const runtime = createBackgroundRuntime();
  const config = { ...DEFAULTS, glossary: "Luma = ルマ", prompt: "Use short sentences." };
  const instructions = () => {
    const value = { config, instructions: [] };
    runtime.emit("translation:instructions", value);
    return value.instructions.join("\n");
  };
  assert.match(instructions(), /ルマ/);
  runtime.configure(["glossary"]);
  assert.doesNotMatch(instructions(), /ルマ/);
  assert.match(instructions(), /short sentences/);
  runtime.configure(["glossary", "custom-prompt", "provider-deepseek"]);
  assert.equal(instructions(), "");
  assert.throws(() => runtime.get("provider.deepseek"));
  runtime.register({
    id: "replacement", provides: ["provider.deepseek"],
    setup(ctx) { ctx.provide("provider.deepseek", { translate: () => "replacement" }); },
  });
  runtime.configure(["provider-deepseek"]);
  assert.equal(runtime.get("provider.deepseek").translate(), "replacement");
  let mounts = 0;
  let signal;
  runtime.register({
    id: "consumer", inject: ["provider.deepseek"],
    setup(ctx) { mounts++; signal = ctx.signal; },
  });
  runtime.configure(["provider-deepseek"]);
  runtime.configure(["provider-deepseek"]);
  assert.equal(mounts, 1, "Inactive original provider must not repeatedly dispose a replacement's dependents");
  assert.equal(signal.aborted, false);
  runtime.configure(["provider-deepseek", "replacement"]);
  assert.equal(signal.aborted, true);
  assert.equal(runtime.list().find(plugin => plugin.id === "consumer").state, "blocked");
});
