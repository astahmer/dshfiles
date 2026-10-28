---
name: dsh-upstream-pr
description: Prepare or open a narrowly scoped PR to astahmer/dshfiles from selected neolectron/dshfiles plugin changes, including an owned plugin when explicitly selected. Use for contributing a plugin, upstreaming a shared-plugin fix, or extracting a clean PR without publishing unrelated fork changes.
---

# Contribute selected changes upstream

Read [fork maintenance](../../../docs/fork-maintenance.md) and
[fork policy](../../../fork-policy.json). This is not a PR of our entire fork.

## 1. Fix the scope and publication boundary

- Ask which plugin(s), behavior and source branch/revisions are intended if not
  supplied. Never guess from "my changes", the namespace, or all of `main`.
- Distinguish **prepare a local PR branch** from **push and open a PR**. The
  latter request authorizes publishing the agreed changes to the user's fork
  and opening the upstream PR; it does not authorize force-push, merging the PR,
  pushing upstream directly, or including unrelated files.
- Explicitly include or exclude an owned plugin; `keep-local` requires a new
  user decision. A contribution candidate is not publication permission.
- Inspect status, worktrees and actual Git/JJ metadata. Use a separate workspace;
  never reset, stash, rewrite or switch another agent's checkout. Load `jj`
  before JJ history operations; do not initialize it in a Git-only checkout.
- Verify the two remote identities and upstream default branch. Fetch the
  intended refs, then record exact upstream base and local source commits.
  Inspect license/provenance and the installed API contracts before adapting.

## 2. Extract behavior, not the fork's history

Start a fresh contribution branch **at current upstream**, not at fork `main`.
Create an explicit file/hunk allowlist including necessary tests, docs,
licenses, screenshot evidence and genuine shared dependencies.

For a shared plugin:

- Read fork-only commits and the three-way diff from the merge base. Prefer a
  cherry-pick only when the commit is already cleanly scoped; inspect its entire
  patch first. Otherwise port the selected hunks/behavior manually.
- Never copy the complete current plugin directory over newer upstream code.
  Preserve unrelated upstream improvements and omit personal configuration.

For an owned plugin:

- Add its source, provenance, tests, feature catalog and required dependencies.
  Explain the supported Host/dshx contract and setup in its README.
- Do not enable it in Astahmer's personal profile by default. Offer optional
  installation; include profile wiring only when explicitly part of the PR.
- If it requires a large fork-only dshx feature or another owned plugin, list
  that dependency. Propose a small prerequisite PR or ask whether to expand the
  scope; do not smuggle the whole fork into the lockfile.

Keep dependency manifest/catalog edits minimal; regenerate rather than copy
our entire lockfile. Never copy live profiles, account files, `.secret.json`,
DSH homes, personal launchers or private plan backports. Review added fixtures
and screenshots for secrets and personal information.

## 3. Prove the exact patch against upstream

- In Git, read **every** change in `git diff <upstream-base>...HEAD`, its file
  list and `git log <upstream-base>..HEAD`. In JJ, Git `HEAD` can lag behind `@`:
  inspect `jj diff --from <upstream-base> --to <contribution-bookmark>` and
  `jj log -r '<upstream-base>..<contribution-bookmark>'` for the exact named
  bookmark to be pushed, resolving commits when needed. Check both patch and
  history match the allowlist and only intended commits are outgoing. Check
  new/untracked files, Git staged files or JJ working changes separately.
- Run focused checks in this upstream-based workspace, not merely in the full
  fork where hidden dependencies may make it pass. Load `dsh-plugin-verify`
  and `verify-dsh` for changed plugins; preserve real evidence and distinguish
  skipped/baseline failures. Never use the live GUI as a test environment.
- Keep Conventional Commit messages and the required co-author trailer. Write a
  simple, concise PR body: the user-visible **Problem** and **Solution**, then
  checks, dependencies, activation steps and anything deliberately left fork-local.
- For UI features, embed a screenshot in the PR body with Markdown image syntax,
  using a commit-pinned raw URL or a GitHub-uploaded attachment, not a local path.
  Review the image for secrets and personal information before publishing it.

## 4. Publish only with the agreed authorization

Show the exact patch, diff summary, fork branch, upstream base, PR title/body and
checks before any publication not already authorized. Open a **draft PR** by
default (and always when requested), unless the user explicitly authorizes a
ready-for-review PR. Let the user review the draft, exact patch and checks;
marking it ready requires their explicit authorization.

Do not add @mentions, reviewers, assignees, review requests, comments or other
unsolicited pings unless explicitly authorized. A draft avoids requesting review;
it cannot guarantee silence from GitHub's subscriber or automation notifications.

Push **only** the scoped contribution branch to `neolectron/dshfiles`, using the
detected VCS; with Git:

```sh
git push --no-follow-tags --recurse-submodules=no origin HEAD:refs/heads/contribute/<topic>
gh pr create --draft --repo astahmer/dshfiles --base <upstream-default-branch> \
  --head neolectron:contribute/<topic> --title '<title>' --body-file <reviewed-body-file>
```

Use explicit values, never paste placeholders literally. In JJ, push only the
named contribution bookmark. Check GitHub authentication without printing
credentials. If push/PR creation fails, report the partial outcome and preserve
the branch; do not broaden permissions or create duplicate PRs.

Record the PR URL and `proposed` intent in the local policy without falsely
marking it accepted. Once merged, the sync skill verifies the upstream fix and
retires the carried delta. An accepted owned plugin becomes shared when it
exists upstream; review rather than preserving a stale `owned` classification.
