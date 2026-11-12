# Plugin capabilities outside the browser: dshx CLI and MCP

Backlog: b:v9ex. GitHub: [astahmer/dshfiles#255](https://github.com/astahmer/dshfiles/issues/255).

**Resume here:** milestone 1 (dshx tool catalog helper) is next; see the progress table.

## Goal

Scripts, terminal users and other agent harnesses (Claude Code, Codex) can list and call the capabilities dshfiles
plugins already expose as agent tools — backlog, jj workspaces, settings, background jobs and the rest — without the
browser, reusing the existing `tool: { name, readOnly, render }` bindings instead of restating them.

## What already exists (researched 2026-11-12)

1. **Every tool-bound dshx API method is already an HTTP route.** `registerRoutes`
   ([host-runtime.ts](../../tooling/dshx/packages/dshx/src/api/host-runtime.ts)) mounts `POST /api/<channel>/<method>`
   for each method, behind DSH's cookie-authenticated `/api` (a bare `curl` gets 401). `apiTool` builds the agent tool
   from the same `dispatch`, so a route call and a tool call run the same validated handler.
2. **Out-of-browser auth already exists.** `connectDshxApi`
   ([dshx-api.ts](../../tooling/dshx/packages/dshx/src/platform/dshx-api.ts)) trades the tokenized loopback launch URL
   (`--url`, `DSHX_URL`, or `~/.dsh/runtime/web-url`) for the session cookie, then calls one API. `dshx config`,
   `dshx sessions` and the backlog reach helper use this path.
3. **Discovery already exists.** The leader Host serves `@dshfiles/dshx` `registry` v1 `list`: every API with owner,
   id, version, methods, the method's `tool` name and (with `schemas: true`) its input JSON Schema. A live read-only
   probe on 2026-11-12 listed 65 APIs, among them `backlog` (`backlog_list`, `backlog_get`, …), `jj-threads`
   (`jj_thread_status`, …), `jujutsu` (`jj_workspaces`, …), `settings-shell` (`settings_list`, `settings_set`, …)
   and `background-jobs` (`background_jobs_board`, …).
   The same listing's `tools[]` carries each tool's effective description, `source: 'api'`, `owner` and `readOnly`
   (DSH's `isConcurrencySafe` marker, set by `readOnly: true`); the live probe saw `backlog_delete` with
   `readOnly: false`. Joining `apis[].methods[].tool` with `tools[]` by name gives everything a caller needs, so no
   Host-side registry change is required and the catalog works against the running Host today.
4. **A Host MCP endpoint already exists.** `@dshfiles/mcp-endpoint`
   ([README](../../plugins/@dshfiles/mcp-endpoint/README.md)) serves stateless streamable HTTP at `/mcp` with its own
   bearer token (SHA-256 stored, issued only in Settings, never by an agent tool), loopback-only unless LAN access is
   on, Origin check, 1 MiB cap and an `mcp request` span. It serves seven hand-written thread tools over
   session-controller's `sessionsApi`; no plugin tool reaches it.
5. **A stdio MCP precedent exists.** `dshx comm mcp` serves the communication bridge over stdio with its own
   socket token. It is domain-specific and not a generic tool bridge.

## Decision

Ship **two surfaces, one catalog**:

1. **MCP: extend the Host endpoint** `@dshfiles/mcp-endpoint`, not a new `dshx mcp` stdio server.
   1. Its auth is already the right shape for another harness: a revocable, rotatable, hashed bearer token scoped to
      MCP, separate from the launch URL. A stdio server would authenticate with the launch URL instead — the full
      browser credential — and duplicate the endpoint's policy (loopback, Origin, size, telemetry).
   2. Claude Code and Codex speak streamable HTTP natively (`claude mcp add --transport http …`), so stdio buys no
      reach on this machine.
   3. Calls run in process through the API registry as caller `@dshfiles/mcp-endpoint`, so each call keeps its
      automatic `api-dispatch` span under the `mcp request` span.
2. **CLI: `dshx tools list|describe|call`** over the existing launch-URL client.
   1. A terminal user already holds the launch URL; `dshx config` and `dshx sessions` use it.
   2. `call` resolves a tool name through the registry to `(owner, api, version, method)` and calls that route; the
      handler validates the input, as for the agent.
3. **One catalog.** A pure dshx helper turns a registry listing (`list({ schemas: true })`) into tool entries
   `{ name, description, readOnly, owner, apiId, version, method, inputSchema }` by joining `apis[].methods[].tool`
   with `tools[]`; a tool whose `readOnly` is absent counts as a write. The endpoint and the CLI both use it, so
   neither restates a tool.

Rejected: a `dshx mcp` stdio server (second auth path holding the launch URL, duplicate policy); a stdio adapter can
be added later over the same catalog if a client lacks HTTP transport.

## Safety rules

1. **Reads first, writes opt-in.** A tool is a read when its binding says `readOnly: true`.
   1. MCP: a new endpoint setting `pluginTools`: `off` (default — an existing token holder gains nothing until the
      user opts in), `read-only`, or `read-write`. Write tools are neither listed nor callable below `read-write`.
   2. CLI: `call` refuses a write tool without `--write`.
2. **Destructive verbs keep their opt-in.** Their input schemas already require an explicit argument with no default
   (`confirm: true`, `explicitApproval`); the catalog publishes that schema unchanged and the handler validates it.
3. **Authenticated.** MCP requires the endpoint bearer token; the CLI requires the launch URL. Nothing new is
   reachable without either.
4. **Never exposed through MCP:** the endpoint's own `mcp_endpoint_*` tools (an outside client must not revoke its
   own token or open LAN access), and the dshx internal APIs (`registry`, `storage`, `browser-traces`), which carry
   no tool binding anyway.
5. **Name clashes:** the endpoint's thread tools (`list_threads`, …) win; a clashing plugin tool is skipped.
6. **No secrets in output.** Results are what the agent already sees; CLI errors go through the existing
   `token=[redacted]` redaction.
7. **Caller identity.** Handlers see a `plugin` caller (`@dshfiles/mcp-endpoint`) over MCP and a `client` caller from
   the CLI, never an agent `sessionId`/`cwd`. Tools that need a calling Session (for example `jj_thread_isolate`)
   fail with their own error; that is expected, not hidden.
8. The endpoint setting change gets an agent tool `mcp_endpoint_set_plugin_tools`, "only when the user asked", like
   `mcp_endpoint_set_lan_access`; `mcp_endpoint_status` shows the current mode (see and reverse).

## Telemetry

1. MCP: plugin tool calls get the automatic `api-dispatch` span under the existing custom `mcp request` span; the new
   `dshx.features.json` feature lists both, with a `recordSpans()` test.
2. CLI: runs outside the Host; the Host side of each call is the automatic `api-dispatch` span. `tooling/dshx` has no
   feature catalog, so no entry is added there.

## Milestones

| #   | Revision (one logical change each)                                                                                        | Owner        | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------ | ------- |
| 0   | `docs(plans): plan plugin capabilities outside the browser`                                                               | orchestrator | done    |
| 1   | `feat(dshx): build a plugin tool catalog from the API registry listing` (+ tests)                                         | subagent A   | pending |
| 2   | `feat(dshx): dshx tools list, describe and call over the launch URL` (+ CLI tests against the in-process test Host)       | subagent B   | pending |
| 3   | `feat(mcp-endpoint): serve plugin tools over MCP behind an off/read-only/read-write setting` (+ Host test, catalog, docs) | subagent C   | pending |
| 4   | `docs: design note for plugin capabilities outside the browser` (`docs/`), README/plan cleanup, b:v9ex closed             | orchestrator | pending |

Milestone 1 lands on `main` first; 2 and 3 start from it in parallel (disjoint paths: `tooling/dshx/packages/dshx/src/cli`
versus `plugins/@dshfiles/mcp-endpoint`).

## Verification

1. dshx: `pnpm --dir tooling/dshx/packages/dshx exec vitest run <spec> ` for the registry/catalog and CLI specs;
   `typecheck`.
2. mcp-endpoint: `pnpm --dir plugins/@dshfiles/mcp-endpoint test`, `typecheck`, `build`, `features:check`.
3. Live, read-only, no restart: `dshx tools list --owner @dshfiles/backlog` and `dshx tools call backlog_list` against
   the running Host (the CLI only needs the rebuilt dshx CLI; the registry fields it reads are live already).
4. The endpoint change needs a Host restart to go live: the user's decision, never ours.
