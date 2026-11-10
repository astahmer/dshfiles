import { Effect } from 'effect'
import { RemoteExec, type RemoteExecResult } from './remote-exec.js'
import { shellQuote } from './ssh.js'

/**
 * Bring one checkout on another machine onto `<bookmark>@origin` without ever losing that machine's work, and say what
 * moved. The rules are the ones `dshx checkout sync` applies to the checkout DSH runs from, for any jj checkout:
 *
 * - Sync fetches and rebases. It never pushes and never moves a bookmark: only origin carries work between hosts.
 * - Undescribed revisions (local edits) ride the rebase; revisions origin already holds drop out.
 * - Described work origin lacks, a conflict, a conflicted bookmark, a stale working copy or another workspace built on
 *   these revisions refuses the sync and names the recovery. The checkout stays as it was.
 *
 * The rebase is first simulated with `--ignore-working-copy` and undone, so a refusal never touches files on disk. The
 * simulation, the check and the undo run as one remote script: a dropped connection cannot strand a half-done rebase.
 */

export type CheckoutSyncStatus =
  /** Nothing comes in and nothing is unpushed. */
  | 'up-to-date'
  /** Nothing comes in, but this checkout holds work origin lacks. */
  | 'ahead'
  /** `apply` would rebase onto the incoming work. */
  | 'would-sync'
  | 'synced'
  | 'jj-missing'
  | 'no-checkout'
  | 'not-jj'
  | 'fetch-failed'
  | 'no-remote-bookmark'
  /** Another workspace rewrote this working copy; jj refuses to touch it until it is updated. */
  | 'stale'
  /** Local and origin moved apart: the bookmark has two targets. */
  | 'bookmark-conflict'
  /** Another workspace's working copy sits on the revisions a rebase would rewrite. */
  | 'workspace-busy'
  /** Described work origin lacks. */
  | 'unpushed-work'
  /** The rebase would conflict, or these revisions already do. */
  | 'conflicted'
  /** The checkout or origin changed after the preview being confirmed. */
  | 'moved'
  | 'failed'

export interface CheckoutRevision {
  readonly changeId: string
  readonly commitId: string
  readonly description: string
  readonly conflict: boolean
  readonly empty: boolean
}

export interface CheckoutRevisionList {
  /** Every matching revision; `revisions` lists the newest of them. */
  readonly total: number
  readonly revisions: readonly CheckoutRevision[]
}

export interface CheckoutBookmark {
  readonly name: string
  /** The local targets: none when the bookmark is not here, two or more when it is conflicted. */
  readonly local: readonly string[]
  readonly origin: string | undefined
  readonly tracked: boolean
  readonly conflicted: boolean
}

export interface CheckoutWorkspace {
  readonly name: string
  readonly path: string | undefined
  readonly commitId: string
  readonly description: string
  /** Its working copy sits on revisions this sync would rewrite. */
  readonly blocksSync: boolean
  /** DSH threads this machine started there, when it knows of any. */
  readonly threads: readonly CheckoutThread[]
}

export interface CheckoutThread {
  readonly sessionId: string
  readonly title: string
}

export interface CheckoutRecovery {
  readonly label: string
  /** Run on that host; absent when the step is not one command. */
  readonly command?: string
}

export interface CheckoutSyncResult {
  readonly ok: boolean
  readonly applied: boolean
  readonly status: CheckoutSyncStatus
  readonly path: string
  readonly bookmark: string
  readonly detail: string
  readonly recovery: readonly CheckoutRecovery[]
  /** The working-copy commit and the origin tip this result is about; a confirmed sync binds to both. */
  readonly head: string | undefined
  readonly target: string | undefined
  readonly bookmarkState: CheckoutBookmark
  readonly incoming: CheckoutRevisionList
  /** Unpushed revisions under the working copy, which a sync moves or refuses over. */
  readonly outgoing: CheckoutRevisionList
  /** Unpushed revisions only the local bookmark reaches; a sync leaves them alone. */
  readonly unpushedBookmark: CheckoutRevisionList
  /** Described revisions origin already holds, which the rebase drops. */
  readonly absorbed: readonly CheckoutRevision[]
  readonly conflictFiles: readonly string[]
  /** Which workspace this checkout is; undefined when the path is not a workspace root jj reports. */
  readonly workspace: CheckoutWorkspace | undefined
  readonly otherWorkspaces: readonly CheckoutWorkspace[]
}

const safeStatuses = new Set<CheckoutSyncStatus>(['up-to-date', 'ahead', 'would-sync', 'synced'])

const listLimit = 30
const workspaceLimit = 64
const conflictFileLimit = 200

/** jj often lives outside a non-login shell's PATH, so the usual install locations come first. */
const usualPath =
  'PATH="$HOME/.nix-profile/bin:/etc/profiles/per-user/$USER/bin:/run/current-system/sw/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"'

const revisionFields = String.raw`change_id.short(12) ++ "\t" ++ commit_id ++ "\t" ++ conflict ++ "\t" ++ empty ++ "\t" ++ description.first_line() ++ "\n"`
const revisionTemplate = (kind: string): string => shellQuote(String.raw`"${kind}\t" ++ ${revisionFields}`)
const bookmarkTemplate = shellQuote(
  String.raw`"bookmark\t" ++ name ++ "\t" ++ if(remote, remote, "") ++ "\t" ++ conflict ++ "\t" ++ tracked ++ "\t" ++ added_targets.map(|c| c.commit_id()).join(",") ++ "\n"`,
)
const localSideTemplate = shellQuote(String.raw`"local-side\t" ++ change_id.short(12) ++ "\n"`)
const workspaceTemplate = shellQuote(String.raw`name ++ "\t" ++ target.commit_id() ++ "\t" ++ target.description().first_line() ++ "\n"`)
const blockerTemplate = shellQuote(String.raw`working_copies.map(|w| w.name()).join("\n") ++ "\n"`)

const preamble = (input: { readonly path: string; readonly bookmark: string }): string =>
  String.raw`${usualPath}
export PATH
repo=${shellQuote(input.path)}
bookmark=${shellQuote(input.bookmark)}
tip="present(\"$bookmark\"@origin)"
J() { jj -R "$repo" --color=never --no-pager "$@"; }
R() { J --ignore-working-copy "$@"; }
oneline() { printf '%s' "$1" | tail -n 3 | tr '\n\t' '  '; }
total() { R log --no-graph -r "$2" -T '"x\n"' 2>/dev/null | wc -l | tr -d ' ' | sed "s/^/count\t$1\t/"; }
operation() { R op log -n 1 --no-graph -T 'id' 2>/dev/null; }
head_commit() { R log --no-graph -r @ -T 'commit_id' 2>/dev/null; }`

/**
 * Fetch from origin, then print what is true of this checkout as tab-separated records. It decides nothing beyond
 * stopping when the next step cannot run. `jj status` snapshots the working copy, so local edits count; no file changes.
 */
const inspectScript = (input: { readonly path: string; readonly bookmark: string }): string =>
  String.raw`${preamble(input)}
command -v jj >/dev/null 2>&1 || { printf 'stop\tjj-missing\n'; exit 0; }
[ -d "$repo" ] || { printf 'stop\tno-checkout\n'; exit 0; }
[ -e "$repo/.jj" ] || { printf 'stop\tnot-jj\n'; exit 0; }
stale=0
if ! snapshot=$(J status 2>&1); then
  case "$snapshot" in
    *stale*|*Stale*) stale=1; printf 'fact\tstale\n' ;;
    *) printf 'stop\tfailed\t%s\n' "$(oneline "$snapshot")"; exit 0 ;;
  esac
fi
if [ "$stale" = 1 ]; then fetched=$(R git fetch --remote origin 2>&1); else fetched=$(J git fetch --remote origin 2>&1); fi
if [ $? -ne 0 ]; then printf 'stop\tfetch-failed\t%s\n' "$(oneline "$fetched")"; exit 0; fi
printf 'root\t%s\n' "$(cd "$repo" && pwd -P)"
R log --no-graph -r @ -T ${revisionTemplate('head')}
R bookmark list "$bookmark" --all-remotes -T ${bookmarkTemplate} 2>/dev/null
R log --no-graph -r "bookmarks(exact:\"$bookmark\") ~ ::$tip" -T ${localSideTemplate} 2>/dev/null
R workspace list -T ${workspaceTemplate} 2>/dev/null | head -n ${workspaceLimit} | while IFS='	' read -r name commit description; do
  printf 'workspace\t%s\t%s\t%s\t%s\n' "$name" "$commit" "$(R workspace root --name "$name" 2>/dev/null)" "$description"
done
target=$(R log --no-graph -r "$tip" -T 'commit_id' 2>/dev/null)
if [ -z "$target" ]; then printf 'stop\tno-remote-bookmark\n'; exit 0; fi
printf 'target\t%s\n' "$target"
incoming="::$tip ~ ::@"
stack="::@ ~ ::$tip"
outgoing="$stack ~ (empty() & description(exact:\"\"))"
local_only="::bookmarks(exact:\"$bookmark\") ~ ::$tip ~ ::@ ~ (empty() & description(exact:\"\"))"
R log --no-graph -n ${listLimit} -r "$incoming" -T ${revisionTemplate('incoming')}
total incoming "$incoming"
R log --no-graph -n ${listLimit} -r "$outgoing" -T ${revisionTemplate('outgoing')}
total outgoing "$outgoing"
R log --no-graph -n ${listLimit} -r "$local_only" -T ${revisionTemplate('bookmark-only')} 2>/dev/null
total bookmark-only "$local_only"
total stack "$stack"
total descendants "@:: ~ @"
R log --no-graph -r "(roots($stack)::) & working_copies() ~ @" -T ${blockerTemplate} 2>/dev/null | sed '/^$/d' | sed 's/^/blocker\t/'`

/**
 * Rebase, read what came of it, and put it back unless it applied cleanly. `--ignore-working-copy` keeps a simulation
 * off the disk; a real run only follows a clean simulation, and undoes itself if a late edit made it unsafe after all.
 * Git commit ids hold whole seconds, so repeating a rebase an undo just reverted recreates its exact commit, which jj
 * refuses: the next second gives a new id.
 */
const rewriteScript = (input: {
  readonly path: string
  readonly bookmark: string
  readonly head: string
  readonly target: string
  readonly lone: boolean
  readonly apply: boolean
}): string =>
  String.raw`${preamble(input)}
head=${shellQuote(input.head)}
target=${shellQuote(input.target)}
apply=${input.apply ? '1' : '0'}
flag=${input.lone ? '-r' : '-b'}
onto="commit_id(\"$target\")"
if [ "$apply" = 1 ]; then J status >/dev/null 2>&1; fi
if [ "$(head_commit)" != "$head" ] || [ "$(R log --no-graph -r "$tip" -T 'commit_id' 2>/dev/null)" != "$target" ]; then
  printf 'rewrite\tmoved\n'
  exit 0
fi
undo() {
  if [ "$(operation)" = "$after_rebase" ]; then J $quiet op restore "$before" >/dev/null 2>&1; else J $quiet op revert "$after_rebase" >/dev/null 2>&1; fi
  restored=$(head_commit)
  if [ "$restored" != "$head" ]; then
    printf 'rewrite\tundo-failed\t%s\t%s\n' "$restored" "$before"
    exit 0
  fi
}
attempt() {
  quiet=$1
  before=$(operation)
  rebased=$(J $quiet rebase "$flag" @ -d "$onto" --skip-emptied 2>&1)
  rebase_status=$?
  case "$rebase_status:$rebased" in
    0:*) ;;
    *'already exists'*)
      sleep 2
      rebased=$(J $quiet rebase "$flag" @ -d "$onto" --skip-emptied 2>&1)
      rebase_status=$?
      ;;
  esac
  if [ "$rebase_status" -ne 0 ]; then
    printf 'rewrite\tfailed\t%s\n' "$(oneline "$rebased")"
    exit 0
  fi
  after_rebase=$(operation)
  after=$(R log --no-graph -r "::@ ~ ::$onto" -T ${shellQuote(revisionFields)} 2>/dev/null)
  unsafe=$(printf '%s\n' "$after" | awk -F'\t' 'NF >= 4 && ($3 == "true" || ($4 == "false" && tolower($5) != "" && tolower($5) != "wip")) { print $2 }')
}
report() {
  printf '%s\n' "$after" | head -n ${listLimit} | sed '/^$/d' | sed 's/^/after\t/'
  for commit in $(printf '%s\n' "$after" | awk -F'\t' '$3 == "true" { print $2 }'); do
    (cd "$repo" && jj --color=never --no-pager --ignore-working-copy resolve --list -r "commit_id(\"$commit\")" 2>/dev/null) | sed -E 's/[[:space:]]+[0-9]+-sided conflict.*$//'
  done | sort -u | head -n ${conflictFileLimit} | sed 's/^/conflict-file\t/'
}
attempt --ignore-working-copy
report
undo
if [ -n "$unsafe" ] || [ "$apply" != 1 ]; then
  printf 'rewrite\tsimulated\n'
  exit 0
fi
attempt ''
if [ -n "$unsafe" ]; then
  report
  undo
  printf 'rewrite\tsimulated\n'
  exit 0
fi
printf 'rewrite\tapplied\t%s\n' "$(head_commit)"`

/** ssh hands a command to the login shell, which may be zsh or fish; these scripts are POSIX sh, so name it. */
const remoteShell = (script: string): string => `sh -c ${shellQuote(script)}`

interface Inspection {
  readonly stop: { readonly reason: CheckoutSyncStatus; readonly detail: string } | undefined
  readonly stale: boolean
  readonly root: string | undefined
  readonly head: CheckoutRevision | undefined
  readonly target: string | undefined
  readonly bookmark: CheckoutBookmark
  readonly incoming: CheckoutRevisionList
  readonly outgoing: CheckoutRevisionList
  readonly unpushedBookmark: CheckoutRevisionList
  /** The change a conflicted bookmark's local side stands on. */
  readonly localSide: string | undefined
  readonly stackSize: number
  readonly descendants: number
  readonly workspaces: readonly CheckoutWorkspace[]
}

interface Rewrite {
  readonly outcome: 'moved' | 'simulated' | 'applied' | 'failed' | 'undo-failed' | undefined
  readonly detail: string
  readonly operation: string | undefined
  readonly after: readonly CheckoutRevision[]
  readonly conflictFiles: readonly string[]
}

const count = (value: string | undefined): number => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

const revisionOf = (fields: readonly string[]): CheckoutRevision => ({
  changeId: fields[0] ?? '',
  commitId: fields[1] ?? '',
  conflict: fields[2] === 'true',
  empty: fields[3] === 'true',
  description: fields.slice(4).join('\t').trim(),
})

const stopStatuses = ['jj-missing', 'no-checkout', 'not-jj', 'fetch-failed', 'no-remote-bookmark', 'failed'] as const

const stopOf = (fields: readonly string[] | undefined): Inspection['stop'] => {
  const reason = stopStatuses.find(status => status === fields?.[0])
  return reason === undefined ? undefined : { reason, detail: (fields ?? []).slice(1).join(' ').trim() }
}

const revisionListOf = (input: { readonly rows: readonly CheckoutRevision[]; readonly total: number | undefined }): CheckoutRevisionList => ({
  total: input.total ?? input.rows.length,
  revisions: input.rows,
})

/** Remote facts, decoded from the script's records; an unknown record is ignored so an older reader stays safe. */
const parseInspection = ({ stdout, bookmark }: { readonly stdout: string; readonly bookmark: string }): Inspection => {
  const records = stdout.split('\n').map(line => line.split('\t'))
  const fieldsOf = (kind: string): readonly (readonly string[])[] => records.filter(record => record[0] === kind).map(record => record.slice(1))
  const revisionsOf = (kind: string): readonly CheckoutRevision[] => fieldsOf(kind).map(revisionOf)
  const counts = new Map(fieldsOf('count').map(([name, value]) => [name, count(value)]))
  const root = fieldsOf('root')[0]?.join('\t')
  const head = revisionsOf('head')[0]
  const blockers = new Set(fieldsOf('blocker').map(([name]) => name))
  const bookmarks = fieldsOf('bookmark').filter(([name]) => name === bookmark)
  const targetsOf = (row: readonly string[] | undefined): readonly string[] => (row?.[4] ?? '').split(',').filter(commit => commit.length > 0)
  const local = bookmarks.find(row => row[1] === '')
  const origin = bookmarks.find(row => row[1] === 'origin')
  return {
    stop: stopOf(fieldsOf('stop')[0]),
    stale: fieldsOf('fact').some(([fact]) => fact === 'stale'),
    root,
    head,
    target: fieldsOf('target')[0]?.[0],
    bookmark: {
      name: bookmark,
      local: targetsOf(local),
      origin: targetsOf(origin)[0],
      tracked: origin?.[3] === 'true',
      conflicted: local?.[2] === 'true',
    },
    incoming: revisionListOf({ rows: revisionsOf('incoming'), total: counts.get('incoming') }),
    outgoing: revisionListOf({ rows: revisionsOf('outgoing'), total: counts.get('outgoing') }),
    unpushedBookmark: revisionListOf({ rows: revisionsOf('bookmark-only'), total: counts.get('bookmark-only') }),
    localSide: fieldsOf('local-side')[0]?.[0],
    stackSize: counts.get('stack') ?? 0,
    descendants: counts.get('descendants') ?? 0,
    workspaces: fieldsOf('workspace').map(([name = '', commitId = '', path, ...description]) => ({
      name,
      commitId,
      path: path || undefined,
      description: description.join('\t').trim(),
      threads: [],
      // A workspace sharing this working copy goes stale just like one built on it.
      blocksSync: blockers.has(name) || (head !== undefined && commitId === head.commitId && root !== undefined && path !== root),
    })),
  }
}

const rewriteOutcomes = ['moved', 'simulated', 'applied', 'failed', 'undo-failed'] as const

const parseRewrite = (stdout: string): Rewrite => {
  const records = stdout.split('\n').map(line => line.split('\t'))
  const fieldsOf = (kind: string): readonly (readonly string[])[] => records.filter(record => record[0] === kind).map(record => record.slice(1))
  const result = fieldsOf('rewrite').at(-1)
  const outcome = rewriteOutcomes.find(known => known === result?.[0])
  return {
    outcome,
    detail: result?.[1] ?? '',
    operation: outcome === 'undo-failed' ? result?.[2] : undefined,
    after: fieldsOf('after').map(revisionOf),
    conflictFiles: [...new Set(fieldsOf('conflict-file').map(fields => fields.join('\t')))],
  }
}

const plural = (amount: number, noun: string): string => `${amount} ${noun}${amount === 1 ? '' : 's'}`
const short = (commit: string | undefined): string => commit?.slice(0, 12) ?? 'unknown'

const isLocalEdit = (revision: CheckoutRevision): boolean => {
  const description = revision.description.trim().toLowerCase()
  return description === '' || description === 'wip'
}

const repoCommand = (path: string, rest: string): string => `jj -R ${shellQuote(path)} ${rest}`

/** What a person runs on that host next. Every refusal names at least one way forward, and none of them is a sync. */
const recoveryOf = (input: {
  readonly status: CheckoutSyncStatus
  readonly path: string
  readonly inspection: Inspection
  readonly unpushed: readonly CheckoutRevision[]
}): readonly CheckoutRecovery[] => {
  const { status, path, inspection, unpushed } = input
  const name = inspection.bookmark.name
  const origin = shellQuote(`${name}@origin`)
  const jj = (rest: string) => repoCommand(path, rest)
  switch (status) {
    case 'jj-missing':
      return [{ label: 'Install jj on the host, then check again. `multi_host_doctor` lists what else it lacks.' }]
    case 'no-checkout':
      return [{ label: 'Check the path, or use Clone project on the Hosts page to create this checkout.' }]
    case 'not-jj':
      return [
        {
          label: 'Start tracking this Git checkout with jj (it keeps the Git history), then check again.',
          command: `cd ${shellQuote(path)} && jj git init --colocate`,
        },
      ]
    case 'fetch-failed':
      return [
        { label: 'See why fetching fails on the host; a repository with no remote needs one named origin.', command: jj('git fetch --remote origin') },
        { label: 'List the remotes this checkout knows.', command: jj('git remote list') },
      ]
    case 'no-remote-bookmark':
      return [
        {
          label: `Publish ${name} from the host that has it (run this there), or choose a bookmark that exists on origin.`,
          command: jj(`git push --bookmark ${shellQuote(name)}`),
        },
      ]
    case 'stale':
      return [
        {
          label: 'Update this working copy. Copy aside any file edited since the other workspace rewrote it: jj cannot record those edits while it is stale.',
          command: jj('workspace update-stale'),
        },
      ]
    case 'bookmark-conflict': {
      const side = inspection.localSide
      return [
        ...(side === undefined
          ? []
          : [
              {
                label: 'Keep the local commits: rebase them onto origin and point the bookmark at them. Push when ready.',
                command: `${jj(`rebase -b ${side} -d ${origin}`)} && ${jj(`bookmark set ${shellQuote(name)} --allow-backwards -r ${side}`)}`,
              },
            ]),
        {
          label: `Or follow origin: the local commits stay in the repository${side === undefined ? '' : ` as ${side}`}, without the bookmark.`,
          command: jj(`bookmark set ${shellQuote(name)} --allow-backwards -r ${origin}`),
        },
      ]
    }
    case 'workspace-busy':
      return [
        ...inspection.workspaces
          .filter(workspace => workspace.blocksSync)
          .map(workspace => ({
            label: `Finish or move the work in workspace ${workspace.name}${workspace.path === undefined ? '' : ` (${workspace.path})`}, then check again.`,
            command: workspace.path === undefined ? jj('workspace list') : repoCommand(workspace.path, 'log -r @'),
          })),
      ]
    case 'unpushed-work': {
      const tip = unpushed[0]
      return [
        {
          label: 'Rebase this work onto origin yourself; it then shows as not pushed and no longer blocks a sync.',
          command: jj(`rebase -b @ -d ${origin}`),
        },
        ...(tip === undefined
          ? []
          : [
              {
                label: 'Publish it: move the bookmark to it and push (run after the rebase).',
                command: `${jj(`bookmark set ${shellQuote(name)} -r ${tip.changeId}`)} && ${jj(`git push --bookmark ${shellQuote(name)}`)}`,
              },
              { label: 'Or keep it on this machine only: mark it as local work, and it rides each sync.', command: jj(`describe -r ${tip.changeId} -m wip`) },
            ]),
      ]
    }
    case 'conflicted':
      return [
        { label: 'Rebase by hand, fix the listed files, then check again.', command: jj(`rebase -b @ -d ${origin}`) },
        { label: 'Or set this work aside on its own revision and start from origin; the work stays in the repository.', command: jj(`new ${origin}`) },
      ]
    case 'moved':
      return [{ label: 'Check again, read the new report, then confirm.' }]
    case 'failed':
      return [{ label: 'See the error on the host; nothing changed unless the operation log shows it.', command: jj('op log -n 5') }]
    case 'ahead': {
      const tip = (inspection.outgoing.revisions.find(revision => !isLocalEdit(revision)) ?? inspection.unpushedBookmark.revisions[0])?.changeId
      return tip === undefined
        ? []
        : [
            {
              label: 'Sync never pushes. Publish this work from the host when it is ready.',
              command: `${jj(`bookmark set ${shellQuote(name)} -r ${tip}`)} && ${jj(`git push --bookmark ${shellQuote(name)}`)}`,
            },
          ]
    }
    default:
      return []
  }
}

const detailOf = (input: {
  readonly status: CheckoutSyncStatus
  readonly inspection: Inspection
  readonly reason: string
  readonly blocking: readonly CheckoutWorkspace[]
  readonly unpushed: readonly CheckoutRevision[]
  readonly conflictFiles: readonly string[]
}): string => {
  const { status, inspection, reason, blocking, unpushed, conflictFiles } = input
  const name = inspection.bookmark.name
  const incoming = plural(inspection.incoming.total, 'incoming revision')
  switch (status) {
    case 'up-to-date':
      return `Up to date with ${name}@origin.`
    case 'ahead':
      return `Nothing to bring in. ${plural(inspection.outgoing.total + inspection.unpushedBookmark.total, 'revision')} here are not on ${name}@origin yet.`
    case 'would-sync':
      return `Would rebase onto ${name}@origin: ${incoming}.`
    case 'synced':
      return `Rebased onto ${name}@origin: ${incoming}. Nothing was pushed.`
    case 'jj-missing':
      return 'jj is not installed on this host.'
    case 'no-checkout':
      return 'There is no checkout at that path.'
    case 'not-jj':
      return 'This folder is not a jj checkout.'
    case 'fetch-failed':
      return `jj git fetch failed on the host: ${reason}`
    case 'no-remote-bookmark':
      return `Origin has no bookmark ${name}. Nothing changed.`
    case 'stale':
      return 'This working copy is stale: another workspace rewrote it. Nothing changed.'
    case 'bookmark-conflict':
      return `${name} is conflicted: this host and origin moved it apart. Nothing changed, and neither side is lost.`
    case 'workspace-busy':
      return `Rebasing would rewrite the working copy of ${blocking.map(workspace => workspace.name).join(', ')}. Nothing changed.`
    case 'unpushed-work':
      return `${plural(unpushed.length, 'described revision')} here ${unpushed.length === 1 ? 'is' : 'are'} not on ${name}@origin. Nothing changed.`
    case 'conflicted':
      return conflictFiles.length === 0
        ? 'These revisions conflict. Nothing changed.'
        : `Rebasing would conflict in ${plural(conflictFiles.length, 'file')}. Nothing changed.`
    case 'moved':
      return 'The checkout or origin changed since this preview. Nothing changed.'
    case 'failed':
      return reason === '' ? 'The sync failed on the host.' : `The sync failed on the host: ${reason}`
  }
}

const emptyList: CheckoutRevisionList = { total: 0, revisions: [] }

const resultOf = (input: {
  readonly path: string
  readonly bookmark: string
  readonly status: CheckoutSyncStatus
  readonly applied?: boolean
  readonly inspection: Inspection
  readonly reason?: string
  readonly rewrite?: Rewrite
}): CheckoutSyncResult => {
  const { path, bookmark, status, inspection, rewrite } = input
  const after = rewrite?.after ?? []
  const unpushed =
    rewrite === undefined
      ? inspection.outgoing.revisions.filter(revision => !isLocalEdit(revision))
      : after.filter(revision => !revision.empty && !isLocalEdit(revision))
  const kept = new Set(after.map(revision => revision.changeId))
  const absorbed =
    rewrite === undefined || status === 'unpushed-work'
      ? []
      : inspection.outgoing.revisions.filter(revision => !isLocalEdit(revision) && !kept.has(revision.changeId))
  const conflictFiles = rewrite?.conflictFiles ?? []
  const blocking = inspection.workspaces.filter(workspace => workspace.blocksSync)
  const own = inspection.workspaces.find(workspace => workspace.path !== undefined && workspace.path === inspection.root)
  return {
    ok: safeStatuses.has(status),
    applied: input.applied === true,
    status,
    path,
    bookmark,
    detail: detailOf({ status, inspection, reason: input.reason ?? '', blocking, unpushed, conflictFiles }),
    recovery: recoveryOf({ status, path, inspection, unpushed }),
    head: rewrite?.outcome === 'applied' ? rewrite.detail : inspection.head?.commitId,
    target: inspection.target,
    bookmarkState: inspection.bookmark,
    incoming: inspection.incoming,
    outgoing: inspection.outgoing,
    unpushedBookmark: inspection.unpushedBookmark,
    absorbed,
    conflictFiles,
    workspace: own,
    otherWorkspaces: inspection.workspaces.filter(workspace => workspace !== own),
  }
}

const emptyInspection = (bookmark: string): Inspection => ({
  stop: undefined,
  stale: false,
  root: undefined,
  head: undefined,
  target: undefined,
  bookmark: { name: bookmark, local: [], origin: undefined, tracked: false, conflicted: false },
  incoming: emptyList,
  outgoing: emptyList,
  unpushedBookmark: emptyList,
  localSide: undefined,
  stackSize: 0,
  descendants: 0,
  workspaces: [],
})

const connectionFailure = (exec: RemoteExecResult): string => {
  if (exec.timedOut) return 'the host did not answer in time; retry, then read its state with `jj op log`'
  return exec.stderr.trim().split('\n').at(-1) ?? `exit ${exec.code ?? 'unknown'}`
}

const fetchAndInspect = Effect.fnUntraced(function* (input: { readonly sshTarget: string; readonly path: string; readonly bookmark: string }) {
  const exec = yield* RemoteExec.run({ sshTarget: input.sshTarget, command: remoteShell(inspectScript(input)), timeoutMs: 180_000 })
  return { exec, inspection: parseInspection({ stdout: exec.stdout, bookmark: input.bookmark }) }
})

/** The status a report ends on without rewriting anything; undefined when only a rebase can tell. */
const standingStatus = (inspection: Inspection): CheckoutSyncStatus | undefined => {
  if (inspection.stop !== undefined) return inspection.stop.reason
  if (inspection.stale) return 'stale'
  if (inspection.bookmark.conflicted) return 'bookmark-conflict'
  if (inspection.incoming.total === 0) return inspection.outgoing.total + inspection.unpushedBookmark.total === 0 ? 'up-to-date' : 'ahead'
  if (inspection.outgoing.revisions.some(revision => revision.conflict)) return 'conflicted'
  if (inspection.workspaces.some(workspace => workspace.blocksSync)) return 'workspace-busy'
  return undefined
}

const runCheckoutSync = Effect.fn('remote checkout sync')(function* (input: {
  readonly sshTarget: string
  readonly path: string
  readonly bookmark: string
  readonly apply: boolean
  /** The `head` and `target` of the preview being confirmed: the sync refuses when either moved. */
  readonly expectedHead?: string | undefined
  readonly expectedTarget?: string | undefined
}) {
  const { sshTarget, path, bookmark, apply } = input
  const base = { path, bookmark }
  const { exec, inspection } = yield* fetchAndInspect({ sshTarget, path, bookmark })
  if (!exec.ok) return resultOf({ ...base, status: 'failed', inspection: emptyInspection(bookmark), reason: connectionFailure(exec) })
  const standing = standingStatus(inspection)
  if (standing !== undefined) return resultOf({ ...base, status: standing, inspection, reason: inspection.stop?.detail ?? '' })
  const { head, target } = inspection
  if (head === undefined || target === undefined) return resultOf({ ...base, status: 'failed', inspection, reason: 'the host reported no working copy' })
  const unconfirmed =
    (input.expectedHead !== undefined && input.expectedHead !== head.commitId) || (input.expectedTarget !== undefined && input.expectedTarget !== target)
  if (apply && unconfirmed) return resultOf({ ...base, status: 'moved', inspection })

  const rewriteExec = yield* RemoteExec.run({
    sshTarget,
    command: remoteShell(
      rewriteScript({ path, bookmark, head: head.commitId, target, lone: inspection.stackSize === 1 && inspection.descendants === 0, apply }),
    ),
    timeoutMs: 180_000,
  })
  if (!rewriteExec.ok) return resultOf({ ...base, status: 'failed', inspection, reason: connectionFailure(rewriteExec) })
  const rewrite = parseRewrite(rewriteExec.stdout)
  const withRewrite = { ...base, inspection, rewrite }
  switch (rewrite.outcome) {
    case 'moved':
      return resultOf({ ...withRewrite, status: 'moved' })
    case 'failed':
      return resultOf({ ...withRewrite, status: 'failed', reason: rewrite.detail })
    case 'undo-failed':
      return resultOf({
        ...withRewrite,
        status: 'failed',
        reason: `undoing the rebase left the working copy at ${short(rewrite.detail)}; inspect it with jj op log, and restore operation ${short(rewrite.operation)} if nothing else changed`,
      })
    case 'applied':
      return resultOf({ ...withRewrite, status: 'synced', applied: true })
    case 'simulated': {
      if (rewrite.after.some(revision => revision.conflict)) return resultOf({ ...withRewrite, status: 'conflicted' })
      if (rewrite.after.some(revision => !revision.empty && !isLocalEdit(revision))) return resultOf({ ...withRewrite, status: 'unpushed-work' })
      return resultOf({ ...withRewrite, status: 'would-sync' })
    }
    case undefined:
      return resultOf({ ...withRewrite, status: 'failed', reason: 'the host printed no result' })
  }
})

/** Name the threads this machine started in each workspace, so a report says who is working where. */
const withThreads = (input: {
  readonly result: CheckoutSyncResult
  readonly threads: readonly { readonly sessionId: string; readonly title: string; readonly cwd: string }[]
}): CheckoutSyncResult => {
  const named = (workspace: CheckoutWorkspace): CheckoutWorkspace => ({
    ...workspace,
    threads: input.threads
      .filter(thread => workspace.path !== undefined && (thread.cwd === workspace.path || thread.cwd.startsWith(`${workspace.path}/`)))
      .map(thread => ({ sessionId: thread.sessionId, title: thread.title })),
  })
  return {
    ...input.result,
    workspace: input.result.workspace === undefined ? undefined : named(input.result.workspace),
    otherWorkspaces: input.result.otherWorkspaces.map(named),
  }
}

/**
 * Fetch the repository a remote thread is about to work in, so its bookmarks match origin. Fetch only moves remote
 * bookmarks (and tracked ones that did not diverge), never anyone's working copy. jj often lives outside a
 * non-login shell's PATH, so the usual install locations come first.
 */
const fetchBeforeThreadCommand = (cwd: string): string => `${usualPath} jj -R ${shellQuote(cwd)} git fetch`

export class RemoteCheckout {
  static readonly fetchBeforeThreadCommand = fetchBeforeThreadCommand
  static readonly remoteShell = remoteShell
  static readonly parseInspection = parseInspection
  static readonly standingStatus = standingStatus
  static readonly fetchAndInspect = fetchAndInspect
  static readonly report = resultOf
  static readonly withThreads = withThreads
  static readonly emptyInspection = emptyInspection
  static readonly run = runCheckoutSync
}
