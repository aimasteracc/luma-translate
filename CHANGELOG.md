# Changelog

## 0.2.0 — 2026-11-03

- Add per-site permission recovery directly in the side panel and track the correct site across tab changes. Add the tabs permission for site identification.
- Replace the static plugin description dialog with live enable/disable controls, dependency/error states and optional developer metadata.
- Add a shared plugin runtime with services, declared dependencies, reversible hooks/listeners, abort signals and setup rollback.
- Make providers, prompt instructions, extraction, rendering, page translation, selection and dynamic observation participate in the runtime.
- Restore original DOM when rendering is disabled and stop dependent features. Re-enable selection without duplicate requests.
- Force connection tests and explicit retranslation to reach the API. Preserve selected text across focus changes.
- Prevent requests that were cancelled during settings loading; prevent stale selection results from overwriting newer requests.
- Yield while scanning large DOMs; render inline fragments inline rather than turning each into a full-width card.
- Preserve plugin settings when an existing settings form is saved; show toolbar/side-panel errors for failed shortcut/context-menu injection.
- Use the unchanged production manifest in browser tests, separate API/page origins, and exercise permission recovery and plugin switches through UI controls.
- Derive ZIP filenames from the manifest version.

Known limits: no real DeepSeek-key verification, no native permission-dialog automation, no Harness plugin execution compatibility, no external plugin marketplace or site-adapter catalog. See docs/QA.md and docs/EXTENDING.md.

## 0.1.0 — 2026-11-02

Initial public prerelease: DeepSeek/compatible API settings, whole-page/selection translation, bilingual rendering and opt-in automatic translation. Its fixed registries were not a plugin lifecycle runtime.
