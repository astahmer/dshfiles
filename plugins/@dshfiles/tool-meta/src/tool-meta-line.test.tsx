import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ToolMetaTranslate } from './locales.js'
import { ToolMetaLine } from './tool-meta-line.js'
import { ApprovalWaits } from './approval-waits.js'

vi.mock('@dshfiles/dshx/client', async original => ({
  ...(await original<typeof import('@dshfiles/dshx/client')>()),
  useSettings: () => ({ value: { enabled: true, timeFormat: 'absolute' } }),
}))

const templates = new Map([
  ['approvalWaiting', 'Waiting for approval'],
  ['approvalRejected', 'Rejected'],
])
const englishToolMeta: ToolMetaTranslate = (key, params) => (templates.get(key) ?? key).replaceAll(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))

type OwnerPatch = {
  readonly callId?: string
  readonly phase?: 'start' | 'result'
  readonly block?: {
    readonly time: number
    readonly callTime?: number
    readonly isError?: boolean
    readonly content?: ReadonlyArray<{ readonly type: string; readonly text: string }>
  }
}

// SAFETY: the line reads only `phase`, `callId`, `toolName` and the block's times and content.
const owner = (patch: OwnerPatch): ToolCallOwnerProps => ({ callId: 'call-1', toolName: 'bash', ...patch }) as unknown as ToolCallOwnerProps

describe('the tool row while an approval waits', () => {
  it('says "Waiting for approval" and draws no clock', () => {
    ApprovalWaits.track({ callId: 'call-1', key: 'k1', result: new Promise(() => undefined) })
    const html = render(<ToolMetaLine owner={owner({ phase: 'start', block: { time: Date.now() - 24 * 60_000 } })} t={englishToolMeta} />).container.innerHTML
    expect(html).toContain('Waiting for approval')
    expect(html).not.toContain('role="timer"')
  })

  it('reads "Rejected" on its own line once the approval was rejected', () => {
    const block = {
      time: Date.now(),
      callTime: Date.now() - 2_000,
      isError: true,
      content: [{ type: 'text', text: 'Error: the user rejected escalating this command to "danger-full-access"; it stays denied, so stop and explain instead of working around it' }],
    }
    const html = render(<ToolMetaLine owner={owner({ callId: 'call-2', phase: 'result', block })} t={englishToolMeta} />).container.innerHTML
    expect(html).toContain('Rejected')
  })
})
