# Check a thread before landing or completing a goal

Use this checklist to review evidence you already have. It does not run checks, answer questions, land work, or complete a goal. **Pending means not established**, not passed. If a required row is pending or fails, stop and review the detail. This guide adds no enforcement or override.

## Identify what you are reviewing

- **Landing:** Use the exact thread and its registered workspace on the correct host. Confirm the owning repository and the configured local destination bookmark; it may not be `main`. For a JJ graph review, record the operation ID, workspace commit ID, and destination commit ID, not just change IDs or bookmark names.
- **Goal completion:** Use the exact goal ID and revision in the same thread and compare the achieved result with the goal's objective. Apply the repository rows only when the objective includes that work. Use **Not applicable** only for known exclusions, not for evidence you cannot read. For a goal involving multiple workspaces, review each in scope.
- Compare observations from the same scope. If the workspace, operation, head, destination, latest receipt or its configuration, question state, or goal revision changes, discard the affected result and review again. Separate reads are not an atomic decision, even if the final IDs still match.

## Record one result per row

| Row            | Pass                                                                                                                                                       | Fail                                                                                                       | Pending and where to look                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project Checks | Every in-scope action's latest attempt passed for the exact thread, workspace, commit, configuration and relevant stage.                                   | A matching latest attempt failed or timed out. Record its receipt ID and outcome.                          | Missing, running, cancelled, stale, or unverifiable attempt. Use already available [Project Checks evidence](verification-evidence.md). Match by action ID, not label, and check the stage and source revision. A source check is not proof for a later rebased candidate.                                                     |
| Conflicts      | No recorded conflicts in the complete pinned range or destination tip. This says nothing about future rebase conflicts or edits outside the recorded view. | A revision has a recorded conflict. Note its commit ID and look in History during normal review.           | Missing or ambiguous target, unsnapshotted changes, or incomplete range. See the pinned JJ read below.                                                                                                                                                                                                                         |
| Descriptions   | Every nonempty thread revision in the complete pinned range has a description other than a placeholder.                                                    | A nonempty revision has a blank or `WIP` description after trimming and ignoring case. Note its commit ID. | The revision range or current working-copy content is not established. See the pinned JJ read below.                                                                                                                                                                                                                           |
| Open questions | Current evidence covers the relevant thread and its in-scope delegates, with no unanswered question.                                                       | An in-scope question is still unanswered. Note its thread and question reference.                          | The available [question evidence](../plugins/@dshfiles/agent-questions/README.md) may cover only certain question types or sessions. In `list_thread_questions`, check caller scope, timed-schema coverage, unavailable projections, and pagination; an empty list is not proof. Do not broaden the scan to unrelated threads. |

Project Checks receipts are history, not a statement that the current action set passed. A recent receipt list can omit actions; the receipt view reports configuration freshness as unknown. If you cannot independently bind the action configuration and workspace to the receipt, leave that row pending. Do not refresh the receipts API, Project Checks panel, or Land card for a strict no-snapshot review: refreshing receipt freshness uses a JJ working-copy read that can snapshot. This checklist needs neither a refresh nor a rerun.

## Inspect the recorded JJ graph without a snapshot

This example is for JJ 0.46 and a verified local target of `main`. In Bash, set `WORKSPACE` to the absolute canonical path of the already identified JJ workspace. Do not use an unverified path or change bookmarks to fit this example. If the configured destination is not `main`, use an exact selector for that name instead; a remote bookmark is not a substitute. This example does not cover Git worktrees.

```bash
(
  set -eu
  pending() { printf 'Pending: %s\n' "$1" >&2; exit 1; }
  [[ ${WORKSPACE:-} = /* ]] || pending 'Set WORKSPACE to the verified absolute workspace path.'
  cd -- "$WORKSPACE" || pending 'Workspace is unavailable.'
  [[ $(pwd -P) == "$WORKSPACE" ]] || pending 'Use the canonical workspace path.'

  current_op() {
    jj --ignore-working-copy --at-operation=@ op log --no-graph --limit 1 -T id
  }
  op=$(current_op) || pending 'Could not pin one current JJ operation.'
  [[ $op =~ ^[0-9a-f]{128}$ ]] || pending 'Expected one full operation ID.'
  pinned() { jj --ignore-working-copy --at-operation="$op" "$@"; }
  root=$(pinned workspace root) || pending 'Could not read the workspace root.'
  [[ $root == "$WORKSPACE" ]] || pending 'Path is not the expected workspace root.'
  commit_id() { pinned log --no-graph -r "$1" -T 'commit_id ++ "\n"'; }
  head=$(commit_id @) || pending 'Could not read the recorded workspace revision.'
  base=$(commit_id 'bookmarks(exact:"main")') || pending 'Could not read main.'
  [[ $head =~ ^[0-9a-f]{40}$ && $base =~ ^[0-9a-f]{40}$ ]] || pending 'Expected one workspace revision and one local main revision.'

  head_rev="commit_id(\"$head\")"
  base_rev="commit_id(\"$base\")"
  rows=$(pinned log --no-graph --limit 101 -r "$base_rev | (::$head_rev ~ ::$base_rev)" -T \
    'separate("\t", commit_id, if(conflict, "conflict", "clear"), if(empty, "empty", "nonempty"), if(description.trim().lower() == "" || description.trim().lower() == "wip", "placeholder", "described")) ++ "\n"') \
    || pending 'Could not read the revision range.'
  count=0
  base_seen=0
  row_pattern=$'^[0-9a-f]{40}\t(conflict|clear)\t(empty|nonempty)\t(placeholder|described)$'
  while IFS= read -r row; do
    [[ $row =~ $row_pattern ]] || pending 'Incomplete or malformed revision output.'
    (( count += 1 ))
    [[ ${row:0:40} != "$base" ]] || (( base_seen += 1 ))
  done <<< "$rows"
  [[ $base_seen == 1 ]] || pending 'Expected one destination row.'
  (( count <= 100 )) || pending 'More than 100 rows; review a complete range separately.'
  now=$(current_op) || pending 'Could not recheck the current operation.'
  [[ $now == "$op" ]] || pending 'The operation changed; discard this observation.'
  printf 'operation: %s\nworkspace commit: %s\nmain commit: %s\n%s\n' "$op" "$head" "$base" "$rows"
)
```

Read the last four columns as commit ID, recorded conflict, emptiness, and description status. The row matching `main commit` is the destination, not a thread revision: include it for conflicts but ignore its description. Include empty revisions for conflict review, but ignore them for descriptions. A conflict on an empty merge is still recorded. If the current operation is ambiguous, leave the row pending; do not pick one operation head or retry without `--at-operation`. An unchanged operation pins the recorded head and base, not the files on disk. If you cannot establish that the recorded view represents the intended files, do not mark the working-copy rows passed.

## What the existing controls enforce

The [Land card](../plugins/@dshfiles/diffs-review/README.md) previews revisions and shows available status. It is not clearance. On a separate, authorized land action, [JJ integration](../plugins/@dshfiles/jj-integration/README.md) rechecks activity, including other sessions sharing the workspace, and refuses relevant conflicts or placeholders before advancing the bookmark. The thread-and-delegate question row above does not replace that workspace-wide guard. Project Checks may enforce verification in their configured turn-stop and verified-integration flow; a displayed receipt does not grant that authority. [Goal tools](../plugins/@dshfiles/goal-tool/README.md) still require their normal caller authority and exact goal revision. A repository checklist cannot establish that the goal's objective has been achieved. No row here replaces or bypasses a native guard.
