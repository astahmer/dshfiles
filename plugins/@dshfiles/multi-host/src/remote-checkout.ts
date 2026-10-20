import { shellQuote } from './connectors/ssh.js'
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

const runCheckoutSync = async ({
  sshTarget,
  facts,
  bookmark,
  apply,
  signal,
}: {
  readonly sshTarget: string
  readonly facts: RemoteFacts
  readonly bookmark: string
  readonly apply: boolean
  readonly signal?: AbortSignal | undefined
}): Promise<CheckoutSyncRun> => {
  const plan = planCheckoutSync({ facts, bookmark, apply })
  if (!apply) return { ok: true, applied: false, plan, stdout: '', stderr: '', detail: plan.reason }
  if (plan.upToDate || plan.commands.length === 0) return { ok: true, applied: false, plan, stdout: '', stderr: '', detail: plan.reason }
  let stdout = ''
  let stderr = ''
  for (const command of plan.commands) {
    const result = await RemoteExec.run({ sshTarget, command, timeoutMs: 180_000, signal })
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
      }
    }
  }
  return { ok: true, applied: true, plan, stdout, stderr, detail: `fetched and rebased onto ${bookmark}@origin` }
}

export class RemoteCheckout {
  static readonly plan = planCheckoutSync
  static readonly run = runCheckoutSync
}
