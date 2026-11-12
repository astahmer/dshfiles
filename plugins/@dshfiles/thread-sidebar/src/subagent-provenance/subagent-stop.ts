import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { useState } from 'react'
import type { SubagentPreviewTranslate } from './subagent-live-preview.js'

export const failureMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export type SubagentStopState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'armed' }
  | { readonly kind: 'stopping' }
  | { readonly kind: 'failed'; readonly message: string }

/** Stop is one interrupt verb, armed first: the second press cancels the child's turn through its own session. */
export const useSubagentStop = (input: { readonly binding: SessionBinding | undefined; readonly t: SubagentPreviewTranslate }) => {
  const [stop, setStop] = useState<SubagentStopState>({ kind: 'idle' })
  const armed = stop.kind === 'armed'
  const binding = input.binding
  const cancel = (): void => setStop({ kind: 'idle' })
  const requestStop = (): void => {
    if (!armed) {
      setStop({ kind: 'armed' })
      return
    }
    if (binding === undefined) return
    setStop({ kind: 'stopping' })
    binding.session.cancel().then(
      result => setStop(result.ok ? { kind: 'idle' } : { kind: 'failed', message: result.error.message }),
      (error: unknown) => setStop({ kind: 'failed', message: failureMessage(error) }),
    )
  }
  return { stop, armed, requestStop, cancel }
}
