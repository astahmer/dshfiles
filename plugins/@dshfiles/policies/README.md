# @dshfiles/policies

Binary deny rules layered on DSH permissions. Permissions (sandbox mode, approval policy) decide whether a call may
run or must ask; a policy decides it never runs. A matching call is refused after every permission and approval,
so neither an approval nor a full-access mode can let it through. The guard runs on the Host. Edit rules in
Settings, in the `dshfiles-policies` section, as a JSON array; leaving the field submits valid JSON for saving.

Each rule:

| Field     | Meaning                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `name`    | Shown in the refusal, such as “no force push”.                                                        |
| `tool`    | Whole tool name; `*` is the only wildcard and can match zero or more characters.                      |
| `match`   | Regular expression over the arguments as JSON, case-sensitive; empty matches every call of that tool. |
| `reason`  | Why; the agent reads it in the refusal.                                                               |
| `enabled` | Off keeps the rule without applying it.                                                               |

The check is DSH's monotonic tool guard (`ctx.tools.guard`): it runs for every root and nested (PTC) call, and no
other guard or listener can force-allow a call it denied. A rule whose pattern does not compile denies every call of
its tool (fail closed). The agent gets `policies_list` and `policy_check` (a dry run), both read-only; there is
deliberately no tool to change a policy, because a rule the agent could lift would not bind it.

## Preview limits

The editor does not scan or count past calls. Past impact is unknown, not zero matches. The existing agent dry run
checks committed rules for one supplied input; it is not an unsaved-draft preview or an authorization decision.

An editor preview could reuse the matcher on a draft and one explicitly supplied synthetic example, entirely locally,
without executing a tool, calling the Host, or saving the draft. Evaluating arbitrary regular expressions in the UI
thread can stall the editor, so a preview would need bounded input and a cancellable worker. Browser and Host regex
engines also need to agree on the previewed syntax; unsupported syntax or a timeout must be shown as unknown, not as
no match. A non-match would describe only that example. Without an established privacy-safe aggregate for these
conditions, historical coverage stays unknown.

## Verify

```sh
pnpm --dir plugins/@dshfiles/policies test   # rules, and the guard inside the real DSH tool runtime
```
