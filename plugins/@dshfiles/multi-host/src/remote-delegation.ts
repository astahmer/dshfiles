type TranscriptEntry = { readonly seq: number; readonly kind: 'user' | 'assistant' | 'tool' | 'status'; readonly text: string }
type Waiting = { readonly kind: 'question' | 'tool'; readonly tool: string; readonly since: number }

export type DelegationProgress =
  | { readonly state: 'working' }
  | { readonly state: 'finished'; readonly answer: string }
  | { readonly state: 'failed'; readonly detail: string }
  | { readonly state: 'waiting'; readonly waiting: Waiting }

/**
 * Where a delegated remote thread stands after its prompt: still working until the turn that answers the last user
 * message has ended, then finished with its last assistant text, or failed with the status the Host wrote. A pending
 * question or approval is surfaced, since only the host's own UI can answer it.
 */
const progressOf = (input: {
  readonly entries: readonly TranscriptEntry[]
  readonly running: boolean
  readonly waiting?: Waiting | undefined
}): DelegationProgress => {
  if (input.waiting !== undefined) return { state: 'waiting', waiting: input.waiting }
  if (input.running) return { state: 'working' }
  const lastUser = input.entries.findLastIndex(entry => entry.kind === 'user')
  if (lastUser === -1) return { state: 'working' }
  const after = input.entries.slice(lastUser + 1)
  const answer = after.findLast(entry => entry.kind === 'assistant')
  if (answer !== undefined) return { state: 'finished', answer: answer.text }
  const status = after.findLast(entry => entry.kind === 'status')
  if (status !== undefined) return { state: 'failed', detail: status.text }
  return { state: 'working' }
}

export class RemoteDelegation {
  static readonly progressOf = progressOf
}
