import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useState } from 'react'

const COPIED_MS = 1_500

/** Copies through the Host clipboard and reports `copied` for 1.5 s after a successful write, so a button can swap its glyph or label. */
export const useCopyFeedback = (): { readonly copied: boolean; readonly copy: (text: string) => Promise<boolean> } => {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  const copy = useCallback(async (text: string): Promise<boolean> => {
    const written = await writeClipboard(text)
    if (written) setCopied(true)
    return written
  }, [])
  return { copied, copy }
}
