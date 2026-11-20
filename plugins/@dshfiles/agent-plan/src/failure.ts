/** Pure copy for "Ask to fix" on a failed turn: whether to offer it, and the text it puts in the composer. */

export interface FailureFacts {
  readonly message: string
  readonly code: string | undefined
}

/** Codes the Host uses for a turn the user or DSH stopped, which need no fixing. */
const STOPPED_CODES: ReadonlySet<string> = new Set(['INTERRUPTED', 'ACCOUNT_SIGNED_OUT'])

export const Failure = {
  /** Read what the failure card hands its actions: the failure text and its code (empty when the Host set none). */
  fromTurnError(owner: { readonly message: string; readonly code: string }): FailureFacts {
    const code = owner.code.trim()
    return { message: owner.message.trim(), code: code === '' ? undefined : code }
  },

  /** Whether the card offers the action: a stopped turn needs no fixing. */
  actionable(facts: FailureFacts): boolean {
    return facts.code === undefined || !STOPPED_CODES.has(facts.code)
  },

  /** What "Ask to fix" puts in the composer, quoting the failure. */
  fixPrompt(facts: FailureFacts): string {
    const what = [facts.code, facts.message].filter(part => part !== undefined && part !== '').join(': ')
    return `The last turn failed${what === '' ? '' : ` with "${what}"`}. Find the cause, fix it, and then continue the task.`
  },
}
