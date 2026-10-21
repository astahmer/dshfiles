# Visual annotations plan

## Context

- Existing [reference plan I02](reference-feature-additions.md#L119-L123) recommends a local-development-app-first Agentation probe through DSH's existing [MCP Servers](../plugins/@dshfiles/mcp-servers/README.md#L3-L20), with intended-Session routing, obsolete-target labeling, and no silent resolution.
- DSH composer actions can insert reviewable text, but do not provide a new durable screenshot-attachment upload path: [composer guide](../tooling/dshx/docs/sdk/getting-started.md#L116-L139).
- DSH has additive `shell.overlay` and composer actions. `browserUse` is only an optional provider-registration seam; it exposes no active Browser tab, DOM evaluation, or page-message API. Arbitrary Browser/live-preview annotation needs a Host BrowserPage contract.
- BB Agent Annotations is a first-party desktop Browser-tab feature, not BB web/live preview. Agentation is a separate React overlay + MCP server and uses PolyForm Shield 1.0.0: [BB listing](https://getbb.app/marketplace/agent-annotations), [Agentation MCP](https://www.agentation.com/mcp), [license](https://raw.githubusercontent.com/benjitaylor/agentation/main/LICENSE).

## Goal

Validate whether Agentation, routed through existing DSH MCP Servers, gives the user safe and useful visual feedback on a local React development app without adding a DSH plugin.

## What

Run a dev-only adoption probe against a disposable local React app. Mount a pinned Agentation component in that app, run its MCP server locally, connect via existing MCP Servers, and verify intended-Session annotation context and lifecycle. Treat annotating DSH Web itself and arbitrary external Browser pages as separate future scopes.

## Why

Visual element feedback can be more precise than textual descriptions. Existing MCP plumbing may already cover the dev-app use case; a new plugin would add no value unless the target is DSH's own UI or Agentation is insufficient.

## How

### Conceptual model

```text
Local React dev app overlay
  -> Agentation loopback HTTP annotation store
  -> Agentation stdio MCP tools
  -> existing DSH MCP Servers -> intended DSH Session
```

### Operations / behavior

- Select element/region and enter bounded note.
- Query annotations only for the intended Session/task.
- Mark removed or changed targets stale/obsolete; never silently resolve.
- Add a reviewed, bounded textual descriptor to the intended prompt; no auto-submit.
- Do not claim screenshot capture or durable DSH attachment support in V1.

### Tech choices

| Choice                     | Decision                                                   | Rationale                                                                                   |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Build new DSH plugin first | No                                                         | Existing MCP Servers can test the local React-app use case.                                 |
| Browser target             | Disposable local React dev app                             | DSH has no generic Browser DOM/evaluate contract.                                           |
| Agentation package         | Pin dev-only version; license review before redistribution | PolyForm Shield is not permissive/MIT.                                                      |
| Network                    | Loopback only; allow exact dev origin                      | CORS is not authentication; no wildcard or remote exposure.                                 |
| DSH Web annotations        | Separate later decision                                    | Same-page overlay is possible; external Browser lifecycle and screenshot transport are not. |

### Architecture

Use existing `@dshfiles/mcp-servers` for stdio + local HTTP transport. Keep Agentation component in the sample app's development-only entry point. Never add it to DSH's production bundle during the probe.

## What this allows

- Precise DOM-linked feedback from a local React development app.
- Session-scoped annotation retrieval and explicit stale/resolve behavior.
- A decision on whether to adopt the existing MCP integration or design a native DSH surface.

## What this does not allow

- Arbitrary remote Browser/live-preview inspection, screenshot upload, or production DSH annotations.
- Bundling/redistributing Agentation without license approval.
- Capturing input values, cookies, auth headers, full DOM, or sensitive URL tokens.

## UI & UX

### Desktop

Use Agentation's dev-app overlay. In DSH, expose only existing MCP tools and a reviewable text insertion path; do not create a custom DSH toolbar in the probe.

### Common interactions

| Action                 | Result                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| Annotate an element    | Store bounded note/context in local dev app and return only for selected Session. |
| Navigate/remove target | Mark annotation stale; keep unresolved until explicit user action.                |
| Add to prompt          | Insert a bounded textual summary in draft; user reviews and sends.                |

## Data model

No DSH-owned annotation persistence in the probe. Agentation local storage/server owns its records; DSH receives only an allowlisted descriptor and user note. Verify exact Agentation retention/deletion behavior before use. Redact URL query/hash tokens, input values, credentials, and arbitrary attributes; cap text and metadata.

## Implementation steps

1. Confirm target is a local React dev app and define one disposable sample page; keep DSH web profile unchanged.
2. Pin Agentation component/MCP versions in the sample app only; verify its license for the intended internal use.
3. Bind server to loopback; configure the exact dev origin. Prove no wildcard, public interface, or untrusted remote host can connect.
4. Connect through existing MCP Servers. Test one annotation end-to-end, multi-Session separation, restart behavior, stale element labeling, explicit resolution, and intended-Session routing.
5. Audit exposed fields and retention/deletion: allowlisted role/name/test-id/selector, short visible text, viewport box, safe styles, note; no raw DOM, inputs, cookies, tokens, or prompt bodies.
6. Decide adopt/no-op. If DSH Web itself is a separate goal, write a separate plan for a native additive overlay + composer action. If arbitrary Browser pages are required, define Host BrowserPage lifecycle/origin authorization and attachment transport before UI work.

## Open questions

1. Is the target only a local development app, or should DSH Web itself be annotatable?
2. Is textual DOM context sufficient, or are screenshots a hard requirement?
3. What Agentation version/retention behavior and license scope are acceptable?

## Acceptance criteria

- [ ] Annotation reaches only intended DSH Session exactly once; multi-Session tests pass.
- [ ] Removed/changed target is labeled stale; no silent resolution; resolution is explicit and reviewable.
- [ ] Context is bounded and redacted; no input values, secrets, cookies, full DOM, or unredacted URL tokens.
- [ ] Agentation endpoint is loopback-only with exact-origin policy; no wildcard or remote exposure.
- [ ] Component is development-only; production build contains no Agentation bundle.
- [ ] Retention/deletion is understood and tested; screenshot support is not claimed.
- [ ] No new DSH plugin or profile change is needed for the pilot.

## Decisions log

| Date       | Decision                                                                                | Rationale                                                                          |
| ---------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 2026-10-16 | Useful for local UI feedback; adopt/probe Agentation through existing MCP Servers first | Current DSH MCP transport fits local dev app; avoids duplicate manager/plugin.     |
| 2026-10-16 | Defer native DSH annotation plugin and arbitrary Browser support                        | User target is not yet DSH Web; Browser lifecycle/DOM/screenshot seams are absent. |
