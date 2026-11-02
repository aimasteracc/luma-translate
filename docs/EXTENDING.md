# Extending Luma

Luma uses packaged ES modules with explicit registries, not runtime code downloads.
The extension is intentionally independent of the DeepSeek Harness runtime.
These registries are not a plugin lifecycle system: dependency injection, runtime
mount/unmount, and reversible registrations are not implemented. See
[the reassessment](REWORK.md) for the missing capabilities and proposed design.

## Add a compatible endpoint without code

Choose the compatible API provider in Settings. Supply its base URL, model and key.
The existing adapter supports non-streaming Chat Completions.

## Add a new provider protocol

1. Add `extension/providers/my-provider.js`, exporting an async translator.
2. Register it in `providers/index.js`.
3. Add its identifier to `validateConfig` in `core/config.js`.
4. Add its option and necessary fields to settings and the panel label.
5. Request the exact API origin when saving. Do not request all host access for a provider.
6. Include translation-affecting settings in `cacheKey`.
7. Test cancellation, authentication errors, malformed responses and truncation.

```js
export async function translate(text, config, apiKey, signal) {
  // Send only the intended text/settings to the selected provider.
  // Respect signal, time out before MV3's fetch-response deadline,
  // reject redirects, and return plain translated text.
}
```

Providers run in the service worker. Never import them into a content script.
Never return credentials, raw server errors, request headers or logs to the page.
Only the provider adapter receives the key. Preserve the abort signal through all I/O.

## Add a translation-instruction plugin

Append a packaged object to `core/plugins.js`:

```js
{
  id: "preserve-product-names",
  enabled: config => config.style === "faithful",
  instructions: () => "Keep product names and code identifiers in their original language."
}
```

The existing glossary and custom-prompt features use this same interface.
If a plugin needs a new option, update `DEFAULTS`, validation, UI, and `cacheKey`.
The latter prevents an old translation from being reused after a rule changes.

Instruction plugins receive configuration only. They do not receive API keys,
page DOM, browser APIs, or untrusted executable code. Their returned text becomes
part of the system message. Page text remains a separate user message.

## Rendering and extraction

`content.js` owns DOM access. It uses text nodes and conservative block grouping.
It excludes forms, editable content, code and opt-out regions; translations use
Shadow DOM and `textContent`. Original nodes remain intact so event listeners
survive. Translation-only mode temporarily hides the original or wraps text nodes,
and restore reverses those changes.

Site-specific adapters are not implemented in this first version. If a real site
needs one, add a narrowly matched packaged adapter and a fixture for that site's
structure rather than changing collection globally.

## Operational boundaries

- Two in-flight requests per tab; each selected request is at most 20,000 characters.
- Segments of about 2,200 characters; 25-second response deadline.
- 500 source units per page session; 100 memory-cache entries.
- Selection translation interrupts whole-page work; no competing hidden job.
- Settings writes are serialized; translation changes cancel and invalidate results.
- No arbitrary code plugin marketplace, server daemon, build bundler or analytics.

Acceptance tests for new modules should exercise observable behavior and failures,
including original content restoration and the credential boundary.
