// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconDatabaseOutlineRegular: () => null,
  useAnchoredPosition: () => null,
  useDismissOnOutsidePointer: () => undefined,
}))
import type { ChatViewSlotProps } from '../src/native/contract/slots.ts'
import { TurnUsagePanel } from '../src/native/chat/TurnUsagePanel.tsx'

afterEach(cleanup)

const t: ChatViewSlotProps['t'] = (key, options) => {
  if (key === 'message.turnUsage.count') return `${options?.count ?? ''}`
  if (key === 'message.turnUsage.consumed') return `Usage ${options?.total ?? ''}`
  return key
}

describe('TurnUsagePanel estimated cost', () => {
  it('shows the optional estimate in the usage details dialog', () => {
    render(<TurnUsagePanel usage={{ uncachedInputTokens: 100, outputTokens: 10, totalTokens: 110 }} estimatedCost="≈$0.42" t={t} />)

    fireEvent.click(screen.getByRole('button', { name: 'Usage 110' }))

    expect(screen.getByRole('dialog', { hidden: true })).toBeTruthy()
    expect(screen.getByText('message.turnUsage.cost')).toBeTruthy()
    expect(screen.getByText('≈$0.42')).toBeTruthy()
  })
})
