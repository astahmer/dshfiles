# AI Accounts

AI Accounts runs several subscription accounts side by side. Codex, Claude,
OpenCode Go and Command Code accounts each become their own route in the model
picker. Cursor accounts only track identity and quota, because Cursor sessions
run through the `@dshfiles/cursor-agent` runtime driver.

## Providers

| Kind | Login | Model route | Quota |
| --- | --- | --- | --- |
| Codex | `CODEX_HOME=… codex login`, one shadow home per account | yes | 5-hour and weekly windows, banked resets |
| Claude | `claude /login` under the account's `CLAUDE_CONFIG_DIR`; an optional `claude setup-token` in DSH credentials or the Host environment serves requests | yes | 5-hour, weekly, weekly Opus/Sonnet (`/api/oauth/usage`) |
| OpenCode Go | key in DSH credentials or the Host environment | yes | rolling, weekly and monthly windows |
| Command Code | key in DSH credentials or the Host environment, or `cmd login` | yes | 5-hour and weekly window limits (`/alpha/billing/credits`) |
| Cursor | `cursor-agent login`, or a token in DSH credentials or the Host environment | no | included usage for the billing cycle (undocumented dashboard endpoint) |

The plugin reads Claude Code's login but never refreshes it. When that token
expires, run Claude Code once on the account. Quota needs the interactive
login, because a setup token cannot read usage. Cursor publishes no usage API,
so the plugin reads the dashboard's own endpoint. If Cursor changes that
endpoint, the card reports "unsupported" instead of a guessed number.

## API keys

For keyed accounts, **Configure key…** appears only when the account has no
usable login/key and DSH reports the named credential is missing and writable.
It does not appear for a provider 404 or other request error. Entered keys go
straight to DSH's write-only credential
controller; they are not stored in AI Accounts JSON or sent to chat. Managed
credential-store changes are resolved for the next request without restarting
DSH.

Secret Catalog is optional. When active, the dialog can import a unique global
entry or a project/local entry from a folder you explicitly choose. The Client
sees metadata only; the Host rechecks the selected scope and entry, reads its
value, and writes it to DSH credentials. Unknown or ambiguous rows are hidden.
Without Secret Catalog, direct entry still uses DSH credentials. If credential
management is unavailable, set the named variable in the Host environment;
changing the process environment requires relaunching DSH.

The account field stores only the variable name matching `^[A-Z][A-Z0-9_]*_API_KEY$`.
The checked-in `profiles/web/ai-accounts.json` is seed metadata; an existing
runtime account store lives at `${DSH_HOME:-~/.dsh}/plugins/ai-accounts/accounts.json`.
Changing the seed does not rewrite that runtime store. Edit the account in the
panel or change its `apiKeyEnv` field in the appropriate JSON file, but never put
a secret value in either file. The DSH credential provider is the unversioned
secret store fallback; no separate credential JSON file is needed.

## Editing

Edits save automatically after a short pause by default. A subtle indicator
shows whether changes are unsaved, saving, saved or failed, and a failed save
can be retried. A route slug change saves when you leave the field, so a
half-typed slug never becomes a route. Switch to manual saving (Save and
Revert) under **Settings › AI Accounts**. The same page holds the auto-save
delay, the usage refresh interval, the sidebar and edge surfaces, request
distribution, and the history schedule.

Accounts can also be listed, enabled and edited at the bottom of
**Settings › Models**.

## Usage

A usage strip sits above the sidebar foot (the thread sidebar's
`sidebar.footer.above` seat; with the stock sidebar it renders in place among
the footer actions): one meter per account (its binding
window's percent left over the time to its reset), wrapping onto more lines as
accounts grow; the collapsed rail shows one button with the most critical
account. A spent limit draws as a red "Limit reached" pill. Settings › AI Accounts
› Meter shows picks percent left, time to reset, or both (the default) for the
strip and the rail button. Clicking a meter
opens the popover, which filters by provider and lists one card per enabled
account with quota, each showing its machine, session, weekly and monthly bars,
reset times and snapshot age; accounts with a spent window carry a "Limit
reached" badge and sink below the usable ones until you order them. Accounts
without quota data (signed out, failing) fold into one "N hidden" line that
expands. Strip and popover share one order and one hidden list (Settings › AI
Accounts): drag a meter or card onto another to reorder, or right-click it
(Shift+F10 / the menu key) to move it, hide it, or show every hidden account.
Banked Codex resets can be expanded; spending one stays a manual "Reset usage"
in the Codex app. The draggable edge overlay opens the same popover.

Codex Luna Reserve: the usage read asks for the reserve meter the way the
official client does (`x-openai-codex-luna-reserve: 1`) and shows it as its own
window. It never replaces the ordinary gauges. While a weekly limit is spent,
unreset, and the reserve lasts, requests on that account go out as
`gpt-reserve` (Settings › AI Accounts › Codex Luna Reserve, on by default);
the picker and transcript keep the model you chose.

Failure recovery (Settings › AI Accounts › Failure recovery) decides what a
failed request on an account route does, per kind: connection failure
(resets, timeouts, 5xx, Envoy replay-buffer overflow), rate limit, usage
exhausted, sign-in failure, request too large. The options run in order:
retry the same account (count and doubling backoff), continue on Luna Reserve
(Codex), fail over to the next account of the same provider that offers the
model (usage-strip order, hidden accounts skipped), wait out a declared reset,
resend earlier images as file placeholders, then fail the turn or hand the
failure to DSH's own retry and compaction. Defaults: connection → retry twice,
then fail over; exhausted → Luna Reserve, then fail over; rate limit → fail
over, then wait up to a minute; sign-in and oversized stay with DSH. A
fail-over swaps the account on the wire only, cools the failed account, and
returns the conversation to it once it recovers. Each step shows as a retry
row in the turn. Large tool outputs are never trimmed.
Every open surface shares one Host reading, cached for 30 seconds; **Refresh**
bypasses the cache.

The Host records one quota snapshot per enabled account on startup and then
at a configurable interval, 5 minutes by default and adjustable from 1 to 60
minutes. Snapshots are kept for 90 days by default, up to 365. A reading in
the same interval updates its row instead of adding one. Failed reads write
nothing, and plugin unload cancels an active collection and closes the
storage domain. History reads return at most 5,000 points, keeping recent
forecast inputs, reset boundaries and banked-reset changes. Values stay in
the Host's local `ai_accounts_usage` storage domain. Credentials and raw
responses are not stored.

The **Usage history** panel shows current limits, quota history split at
reset boundaries, banked-reset changes, and a linear depletion estimate based
on the observed pace. It does not import local token logs from Codex CLI or
OpenCode.
