# Plugin capabilities outside the browser

Scripts, terminal users and other agent harnesses (Claude Code, Codex) reach what dshfiles plugins expose as agent
tools — backlog, jj workspaces, settings, background jobs and the rest — through two surfaces that share one catalog.
Neither restates a tool: each lists and calls the dshx API methods that already carry `tool: { name, readOnly }`.

| Surface                                                                                          | Who                                    | Auth                                                                     | Writes                                                            |
| ------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `dshx tools list\|describe\|call` ([CLI reference](../tooling/dshx/docs/cli-reference.md))       | a terminal user or script on this host | the tokenized launch URL (`--url`, `DSHX_URL`, `~/.dsh/runtime/web-url`) | refused unless `--write`                                          |
| plugin tools on `/mcp` ([`@dshfiles/mcp-endpoint`](../plugins/@dshfiles/mcp-endpoint/README.md)) | another agent harness                  | the endpoint's bearer token                                              | setting `pluginTools`: `off` (default), `read-only`, `read-write` |

## The catalog

`pluginToolCatalog({ listing })` (`@dshfiles/dshx/host`) turns the `@dshfiles/dshx`
`registry` v1 `list` result into entries `{ name, description, readOnly, owner, apiId, version, method, inputSchema,
takesInput }`. It joins `apis[].methods[].tool` with `tools[]` by name, keeps only `source: 'api'` tools (the only ones
an API route can call), projects the input schema the way the agent tool does, and counts a tool without
`readOnly: true` as a write.

The full `list({ schemas: true })` exceeds the 1 MiB dispatch payload cap on a real profile (65 APIs, ~450 API tools on
2026-11-12). Both surfaces therefore list without schemas first, then ask for `list({ owner, schemas: true })` per owner
they need. Do not raise the cap.

## Why these two surfaces

Three options were weighed (b:v9ex, [astahmer/dshfiles#255](https://github.com/astahmer/dshfiles/issues/255)):

1. **dshx CLI subcommands** — chosen. A terminal user already holds the launch URL that `dshx config` and
   `dshx sessions` use; the call goes through the same cookie-authenticated `/api/<channel>/<method>` route the browser
   uses, so the owner's handler validates the input.
2. **A `dshx mcp` stdio server** — rejected. It would authenticate with the launch URL, the full browser credential,
   and duplicate the endpoint's policy (loopback, Origin, size cap, telemetry). Claude Code and Codex speak streamable
   HTTP natively. A stdio adapter over the same catalog stays possible if a client lacks HTTP.
3. **The Host MCP endpoint** — chosen, by extending the existing `@dshfiles/mcp-endpoint` rather than adding one. Its
   bearer token is hashed, rotatable, revocable, issued only in Settings and scoped to MCP; calls run in process as
   caller `@dshfiles/mcp-endpoint`.

## Safety rules

1. Reads first, writes opt-in: MCP lists and calls write tools only in `read-write`, re-checking the mode and the tool's
   `readOnly` at call time, so a client with a stale list is still refused. The CLI refuses a write tool without
   `--write`.
2. Destructive verbs keep their own opt-in: their required argument (`confirm: true`, …) is published unchanged and
   validated by the owner's handler. Neither surface adds a default.
3. Never over MCP: the endpoint's own `mcp_endpoint_*` tools (a client must not revoke its token or open LAN access),
   `@dshfiles/dshx` internal APIs, and any name that clashes with the endpoint's thread tools (those win).
4. Caller identity: handlers see a `plugin` caller over MCP and a `client` caller from the CLI, never an agent Session.
   Tools that need a calling Session (for example `jj_thread_isolate`) fail with their own error.
5. The mode is visible and reversible: `mcp_endpoint_status` reports `pluginTools`; Settings › MCP endpoint and
   `mcp_endpoint_set_plugin_tools` (only when the user asked) change it.

## Telemetry

Every call is an automatic `api-dispatch` span on the Host. Over MCP it sits under the custom `mcp request` span
(`gen_ai.tool.name` names the tool); the endpoint's catalog entry `mcp-endpoint-plugin-tools` records both.
