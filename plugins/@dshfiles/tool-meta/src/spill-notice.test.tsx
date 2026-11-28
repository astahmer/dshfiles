import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SpillNotice, spillNoticeOf } from './spill-notice.js'

const NOTICE =
  '(Omitted 14463 bytes. Full formatted result stored at: /var/folders/x1/T/dsh-spill/d9e80f00b699-bash.txt. Use read with offset/limit, or grep this path to search within it.)'
const shown = 'line\n'.repeat(2_900)

// SAFETY: the notice reads only `phase`, the result block's content and `openFile`.
const owner = (text: string, openFile = vi.fn()): ToolCallOwnerProps =>
  ({ callId: 'c', toolName: 'bash', phase: 'result', openFile, block: { isError: false, content: [{ type: 'text', text }] } }) as unknown as ToolCallOwnerProps

describe('a tool output DSH cut and stored', () => {
  it('reads the stored path and how much the card shows from core\'s spill notice', () => {
    expect(spillNoticeOf(`${shown}${NOTICE}`)).toEqual({ path: '/var/folders/x1/T/dsh-spill/d9e80f00b699-bash.txt', shownBytes: shown.length, omittedBytes: 14_463 })
    expect(spillNoticeOf('plain output')).toBeUndefined()
  })

  it('offers "Open full output", which opens the stored file', () => {
    const openFile = vi.fn()
    render(<SpillNotice owner={owner(`${shown}${NOTICE}`, openFile)} />)
    expect(screen.getByText('Showing the last 14 KB of the output.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open full output' }))
    expect(openFile).toHaveBeenCalledWith('/var/folders/x1/T/dsh-spill/d9e80f00b699-bash.txt')
  })
})
