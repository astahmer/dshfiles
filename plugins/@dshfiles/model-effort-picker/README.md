# @dshfiles/model-effort-picker

![Two-pane model picker with brand marks, account chips, quota and effort glyphs](docs/screenshots/model-selection.png)

![Model details with accounts, reasoning slider and the fallback chain](docs/screenshots/model-fallbacks.png)

Replaces the composer model control with two panes. The list names every account-and-model route in one flat, dense
column: the model family's brand mark, the model name, the service that offers it subtly after the name, the account it
belongs to with that account's colour dot, the account's remaining quota, and a six-bar reasoning-effort glyph. The
details pane beside it follows the selected or inspected route with the accounts that offer the same model, a reasoning
slider, Fast mode, and the thread's fallback chain.

The composer trigger still names the model and its provider when two providers offer the same name. The main list always
shows the provider so two identical model names from different services stay distinguishable, while the account tag
keeps only the part that identifies the account (`OpenCode Go Alex` next to `OpenCode Go` becomes `Alex`, and
`GitHub Copilot 1` becomes `#1`). Remaining quota stays muted while healthy and only gains warning colour as it runs low; it names the same binding window the AI Accounts strip uses, not the first session window.

Hovering a truncated account tag or provider name shows the whole label. Hovering the effort glyph opens that model's
reasoning levels over the list and picks one directly.

## Fallback chain

The details pane shows a minimal "No fallbacks" state with a small add action. Stored rungs are compact draggable rows
with their model mark, model name, service, account, remaining quota and a remove action; drag or Alt+Arrow reorders
them. A small control toggles whether the thread stays on a fallback or returns next turn.

## Account swap

When another provider route offers the selected model — a second Codex or Claude account from AI Accounts, say — a swap button sits beside the picker. One click moves the Session to the next such route in catalog order, keeping the reasoning effort when the target advertises it. Settings › Model effort picker turns it off (`accountSwap`) or limits the rotation to a list of route ids (`accountSwapRoutes`; empty means every route that offers the model).

## Fast mode

The picker shows a Fast mode switch only for explicitly supported AI Accounts Codex models: on the inspected route's
header, and on a row's hover. AI Accounts stores the selection per Session in Host memory and uses pi-ai's supported
request-payload hook to send `service_tier: "priority"`, the legacy alias accepted by the Codex backend; native DSH
provider routes and unsupported models are unchanged. Fast mode resets when the Host restarts and may cost more
([OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode.md)).

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The plugin owns the composer model slot; model catalogs, selection projection, availability checks, and writes remain owned by DSH’s `modelDirectories` service. Brand marks are vendored artwork from [`@lobehub/icons`](https://github.com/lobehub/lobe-icons) (MIT).
