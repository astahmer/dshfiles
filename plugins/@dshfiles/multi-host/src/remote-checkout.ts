import { shellQuote } from './ssh.js'
import { Effect } from 'effect'
import { RemoteExec } from './remote-exec.js'
import type { RemoteFacts } from './remote-doctor.js'

export interface CheckoutSyncPlan {
  readonly path: string
  readonly bookmark: string
  readonly upToDate: boolean
  readonly reason: string
  readonly commands: string[]
}

/**
 * Bring one remote checkout to its bookmark's fetched tip, keeping the machine's own edits: `git fetch` then rebase the
 * working copy. Without `apply` this is only the commands a person would run.
 */
const planCheckoutSync = ({
  facts,
  bookmark,
  apply,
}: {
  readonly facts: RemoteFacts
  readonly bookmark: string
  readonly apply: boolean
}): CheckoutSyncPlan => {
  const path = facts.checkout.path
  const jj = facts.jj.path ?? 'jj'
  if (!facts.checkout.exists) {
    return { path, bookmark, upToDate: false, reason: 'no checkout at that path', commands: [] }
  }
  const fetch = `${shellQuote(jj)} -R ${shellQuote(path)} git fetch`
  if (facts.checkout.commitId !== undefined && facts.checkout.commitId === facts.checkout.mainOrigin) {
    return { path, bookmark, upToDate: true, reason: `checkout already at ${facts.checkout.commitId}`, commands: [] }
  }
  const rebase = `${shellQuote(jj)} -R ${shellQuote(path)} rebase -r @ -d ${shellQuote(`${bookmark}@origin`)}`
  if (!apply) return { path, bookmark, upToDate: false, reason: `would fetch and rebase onto ${bookmark}@origin`, commands: [fetch, rebase] }
  return { path, bookmark, upToDate: false, reason: `fetching and rebasing onto ${bookmark}@origin`, commands: [fetch, rebase] }
}

export interface CheckoutSyncRun {
  readonly ok: boolean
  readonly applied: boolean
  readonly plan: CheckoutSyncPlan
  readonly stdout: string
  readonly stderr: string
  readonly detail: string
}

const runCheckoutSync = Effect.fn('remote checkout sync')(function* ({
  sshTarget,
  facts,
  bookmark,
  apply,
}: {
  readonly sshTarget: string
  readonly facts: RemoteFacts
  readonly bookmark: string
  readonly apply: boolean
}) {
  const plan = planCheckoutSync({ facts, bookmark, apply })
  if (!apply) return { ok: true, applied: false, plan, stdout: '', stderr: '', detail: plan.reason } satisfies CheckoutSyncRun
  if (plan.upToDate || plan.commands.length === 0)
    return { ok: true, applied: false, plan, stdout: '', stderr: '', detail: plan.reason } satisfies CheckoutSyncRun
  let stdout = ''
  let stderr = ''
  for (const command of plan.commands) {
    const result = yield* RemoteExec.run({ sshTarget, command, timeoutMs: 180_000 })
    stdout = `${stdout}${result.stdout}`.slice(-16_000)
    stderr = `${stderr}${result.stderr}`.slice(-8_000)
    if (!result.ok) {
      return {
        ok: false,
        applied: true,
        plan,
        stdout,
        stderr,
        detail: result.timedOut ? `${command} timed out` : `${command} exited ${result.code ?? 'unknown'}`,
      } satisfies CheckoutSyncRun
    }
  }
  return { ok: true, applied: true, plan, stdout, stderr, detail: `fetched and rebased onto ${bookmark}@origin` } satisfies CheckoutSyncRun
})

/**
 * Fetch the repository a remote thread is about to work in, so its bookmarks match origin. Fetch only moves remote
 * bookmarks (and tracked ones that did not diverge), never anyone's working copy. jj often lives outside a
 * non-login shell's PATH, so the usual install locations come first.
 */
const fetchBeforeThreadCommand = (cwd: string): string =>
  `PATH="$HOME/.nix-profile/bin:/etc/profiles/per-user/$USER/bin:/run/current-system/sw/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH" jj -R ${shellQuote(cwd)} git fetch`

export class RemoteCheckout {
  static readonly fetchBeforeThreadCommand = fetchBeforeThreadCommand
  static readonly plan = planCheckoutSync
  static readonly run = runCheckoutSync
}
