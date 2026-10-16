import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useState } from 'react'

/** One transient banner per owner; a new report replaces the one on screen. */
export const useToast = () => {
  const [toast, setToast] = useState<{ readonly sequence: number; readonly text: string; readonly success: boolean } | null>(null)
  const show = useCallback(
    (input: { readonly text: string; readonly success: boolean }): void =>
      setToast(previous => ({ sequence: (previous?.sequence ?? 0) + 1, text: input.text, success: input.success })),
    [],
  )
  const element =
    toast === null ? null : toast.success ? (
      <Toast
        key={toast.sequence}
        text={toast.text}
        holdMs={6_000}
        tone="success"
        onDone={() => setToast(current => (current?.sequence === toast.sequence ? null : current))}
      />
    ) : (
      <Toast
        key={toast.sequence}
        text={toast.text}
        holdMs={9_000}
        onDone={() => setToast(current => (current?.sequence === toast.sequence ? null : current))}
      />
    )
  return { show, element }
}
