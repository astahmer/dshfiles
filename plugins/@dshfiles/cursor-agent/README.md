# Cursor Agent ACP for DSH

This Host bundle registers Cursor CLI as the `cursor-acp` DSH runtime driver. DSH retains ownership of each Session, Agent, inbox, turn log, approval decision, and cancellation lifecycle. Cursor receives the user's text prompts and runs its documented ACP client/server flow over a managed stdio subprocess.

## Configure one or more instances

Add rows to the `@dshfiles/cursor-agent` bundle in `cordis.patch.yml`:

```yaml
config:
  instances:
    - id: work
      label: Work Cursor
      credentialRef: CURSOR_API_KEY_WORK
      credentialKind: api-key
```

`credentialRef` names a DSH credential alias; it never contains the key. For an auth token, use `credentialKind: auth-token`, which passes the resolved value as `CURSOR_AUTH_TOKEN`. DSH resolves the alias for each new or resumed provider process and adds it to the managed Cursor process environment. Whether Cursor removes that value from tool subprocess environments has not been verified, so credentialed operation remains gated on an isolated acceptance check.

Status checks inspect the CLI executable and whether the DSH alias is configured. They do not launch Cursor, claim that the remote account has authenticated successfully, or prove tool-child environment isolation.

## Select the runtime

Create a DSH Session with runtime binding `{ driverKind: 'cursor-acp', instanceId: 'work' }`. The provider-native session id and interrupted-operation receipt stay in the DSH storage domain, separate from the Session header and client API.

Cursor ACP currently accepts text prompts. Fork, rollback, image input, and project-defined MCP servers are reported as unsupported. Permission requests can map only to a DSH approval followed by ACP `allow_once`; no persistent allow is granted. If a process stops after an operation begins but before DSH records and acknowledges its response, resume stops with an uncertain-operation error instead of replaying a possible workspace edit.

Cursor's per-instance configuration is stored below `$DSH_HOME/runtime-drivers/cursor-acp/<instance-id>` (or `~/.dsh` when `DSH_HOME` is unset) with private directory permissions. The plugin does not start or authenticate Cursor during status checks.

## Develop

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```
