# Extending Luma 0.2

Luma uses a bundled plugin runtime in `extension/core/runtime.js`. Its ideas are
borrowed from DeepSeek Harness: declared services, `inject` dependencies,
context-scoped effects, events, and reversible lifecycle. This is a small browser
implementation, not Cordis and not an execution environment for Harness plugins.
No JavaScript is downloaded or evaluated from a plugin marketplace.

## Runtime contract

Register `{ id, name, version, description, inject, provides, setup }`, then call
`configure(disabledIds)`. `setup(ctx)` is synchronous and can return a cleanup.
It may start asynchronous work using `ctx.signal`; handle promise rejections.

- `ctx.provide(name, service)` registers a declared service.
- `ctx.get(name)` obtains a declared dependency.
- `ctx.on(event, callback)` registers a reversible hook.
- `ctx.listen(target, event, callback, options)` registers a reversible DOM listener.
- `ctx.effect(cleanup)` registers cleanup for other resources.
- `ctx.signal` is aborted on disposal; all registered effects are unwound.
- `runtime.emit(event, payload)` invokes mounted hooks synchronously.
- `runtime.list()` returns actual active/disabled/blocked/error status and metadata.

Dependencies mount in service order, even if registered in reverse. Disabling a
service provider unmounts its dependents first. Failed setup rolls back its
partial registrations. Reconfiguring an active plugin does not register it twice.
Persisted `disabledPlugins` is reapplied after worker startup or page injection.

Keep IDs stable. A plugin must declare all provided/required services. Do not
register effects after disposal or return an asynchronous setup function.
Settings changes currently stop jobs and clear inserted translations; the user
explicitly starts translation again. UI display-mode changes alone do not do so.

## Current composition

| Context | Plugin | Services / effects |
| --- | --- | --- |
| Service worker | provider-deepseek | provider.deepseek |
| Service worker | provider-compatible | provider.compatible |
| Service worker | glossary, custom-prompt | translation:instructions hooks |
| Content | extractor | extractor.collect |
| Content | renderer | renderer.render; restores original DOM on disposal |
| Content | page | page.start; requires extractor and renderer; cancels queue |
| Content | dynamic | requires page; owns observer and debounce timer |
| Content | selection | selection.show; owns document listeners and popup lifecycle |

The plugin manager reads both runtime catalogs. New registered entries appear
without hardcoding another card or adding their IDs to a background allowlist.
Content entries are queried from the current authorized page. Developer metadata
is collapsed by default; users see a description, status and working switch.

Content implementations still share `content.js` closures. Scheduling remains
inside the page plugin implementation rather than a separately swappable service.
There is no site-adapter registry yet. Those are remaining architectural limits.

## Add a provider

1. Implement a packaged adapter exporting
   `async translate(text, config, apiKey, signal)`.
2. Register `{ label, translate }` in `extension/providers/index.js`.
3. The settings selector, config validation, panel label, and background provider
   plugin are derived from this registry; they require no additional branching.
4. Use `config.endpoint` and `config.model`. Non-DeepSeek providers request the
   exact endpoint origin through the save button. New protocol-specific settings
   still need validation/UI/cache-key changes.
5. Test cancellation, 401/429, malformed/truncated responses and secret handling.

The runtime also permits replacing an existing service slot with a bundled
plugin, provided the original provider is disabled. Tests cover this path.
Providers run only in the service worker; only their translate call receives the
API key. Never send credentials, headers or raw server errors to a content script.

## Add a prompt plugin

Add an entry in `extension/core/plugins.js`:

```js
{
  id: "preserve-product-names",
  name: "Preserve product names",
  enabled: config => config.style === "faithful",
  instructions: () => "Keep product names in their original language."
}
```

The background composition wraps this descriptor in a runtime plugin. Its
instruction hook is removed when disabled and restored once when re-enabled.
Disabling an entry changes the cache key. Hooks receive translation preferences,
not credentials or DOM access. Page text remains separate user content.

## Add a content feature

Register it with the content runtime before `configReady` configures the runtime:

```js
runtime.register({
  id: "page-indicator",
  name: "Page indicator",
  version: "1.0.0",
  inject: ["page"],
  setup(ctx) {
    const indicator = document.createElement("span");
    indicator.dataset.luma = "indicator";
    indicator.textContent = "Luma is ready";
    document.body.append(indicator);
    ctx.effect(() => indicator.remove());
    ctx.listen(window, "resize", () => { /* reposition if needed */ });
  },
});
```

Do not replace original innerHTML, interpret API output as HTML, read form values,
or bypass host permissions. Own observers, timers, nodes, and requests must have
cleanup. Add behavioral tests for disable/re-enable and dependency failure.

## Verification

`npm test` covers the runtime contract and provider handling.
`npm run test:browser` exercises actual extension pages and content scripts with
the production manifest, a temporary browser profile and a local fake API.
`LUMA_LIVE_SMOKE=1 npm run test:browser` additionally checks public-page DOM flows.
See `QA.md` for exact coverage and the remaining real-API/native-UI gaps.
