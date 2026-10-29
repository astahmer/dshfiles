# @dshfiles/policies

Binary deny rules layered on DSH permissions. Permissions (sandbox mode, approval policy) decide whether a call may
run or must ask; a policy decides it never runs. A matching call is refused after every permission and approval,
so neither an approval nor a full-access mode can let it through. Host only; the rules are edited in
**Settings › dshfiles-policies**.

Each rule:

| Field     | Meaning                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `name`    | Shown in the refusal, such as “no force push”.                                                       |
| `tool`    | Tool name; `*` matches any run of characters (`bash`, `mcp__github__*`, `*`).                        |
| `match`   | Regular expression over the call's arguments as JSON (`git push.*--force`); empty denies every call. |
| `reason`  | Why; the agent reads it in the refusal.                                                              |
| `enabled` | Off keeps the rule without applying it.                                                              |

The check is DSH's monotonic tool guard (`ctx.tools.guard`): it runs for every root and nested (PTC) call, and no
other guard or listener can force-allow a call it denied. A rule whose pattern does not compile denies every call of
its tool (fail closed). The agent gets `policies_list` and `policy_check` (a dry run), both read-only; there is
deliberately no tool to change a policy, because a rule the agent could lift would not bind it.

## Verify

```sh
pnpm --dir plugins/@dshfiles/policies test   # rules, and the guard inside the real DSH tool runtime
```
