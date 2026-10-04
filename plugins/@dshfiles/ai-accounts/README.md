# AI Accounts

AI Accounts adds separate Codex and OpenCode Go provider routes. Its **Usage
history** panel is available from the AI Accounts page, the quota footer, and
the sidebar panel list.

The Host records one quota snapshot per enabled, supported account on startup
and at a configurable interval (5 minutes by default). It keeps quota
percentages, provider reset timestamps, banked reset counts, and reported expiry
dates for 90 days by default, configurable up to 365 days. Collection runs at
any whole-minute interval from 1 to 60. History reads return at most 5,000
points, preserving recent forecast inputs, reset boundaries, and reset-bank
changes while sampling older quota points. Collection concurrency is bounded, failed
provider reads do not create misleading zero-valued snapshots, and plugin
unload cancels an active collection. Values remain in the Host's local
`ai_accounts_usage` storage domain; provider credentials and raw responses are
not stored there.

The panel shows current provider limits, quota history split at reset
boundaries, changes in banked reset balance and expiry dates, and a linear
depletion estimate. An estimate uses up to the last 48 snapshots from the
current reset cycle and is shown only with at least three readings across 30
minutes. It compares the estimate with the provider's reported reset time and
is labelled as an observed-pace estimate, not a provider prediction.

Older snapshots remain readable; they do not contain per-reset expiry dates.
Command Code accounts do not currently expose a quota reader. This panel tracks
provider quota history and banked resets; it does not import Codex CLI or
OpenCode local token logs.
