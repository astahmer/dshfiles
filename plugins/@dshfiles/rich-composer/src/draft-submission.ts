import type { SubmitOutcome } from './native/contract/input.ts'

/** Workspace intake and attachment routing must see a real identity, not only the final prompt RPC. */
export async function submitMaterializedDraft(input: {
  readonly signal: AbortSignal
  readonly whenCreated: (signal: AbortSignal) => Promise<void>
  readonly send: () => Promise<SubmitOutcome>
}): Promise<SubmitOutcome> {
  input.signal.throwIfAborted()
  await input.whenCreated(input.signal)
  input.signal.throwIfAborted()
  return input.send()
}
