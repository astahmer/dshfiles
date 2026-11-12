// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconDatabaseOutlineRegular: () => null,
  IconGaugeOutlineRegular: () => null,
  useAnchoredPosition: () => null,
  useDismissOnOutsidePointer: () => undefined,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))
import { UsagePill, type UsagePillProps } from '../src/native/chat/StatsPills.tsx'
import type { SessionUsageCostOwnerProps } from '../src/session-usage-cost.ts'

afterEach(cleanup)

const usage = { uncachedInputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 10 }

const pillProps = (renderCost?: (owner: SessionUsageCostOwnerProps) => ReactNode): UsagePillProps => {
  const props: UsagePillProps = {
    t: (key, options) => (key === 'message.turnUsage.count' ? `${options?.count ?? ''} tok` : key),
    // SAFETY: UsagePill reads only projections and the performance mode, never the Chat snapshot.
    useChat: (() => undefined) as never,
    // SAFETY: the fixture answers only the tokenUsage projection the pill reads.
    useProjection: ((key: string) => (key === 'tokenUsage' ? usage : undefined)) as UsagePillProps['useProjection'],
    // SAFETY: the mode hook is a selector over one value; the fixture pins Detailed.
    usePerformanceUsage: (select => select('detailed')) as UsagePillProps['usePerformanceUsage'],
  }
  if (renderCost === undefined) return props
  // SAFETY: the pill renders only the usageCost seat, so every call carries its owner props.
  props.renderSlot = ((_name: string, owner: SessionUsageCostOwnerProps) => renderCost(owner)) as NonNullable<UsagePillProps['renderSlot']>
  return props
}

describe('UsagePill cost seat', () => {
  it('renders a contribution after the label and beside each present bucket', () => {
    const placements: string[] = []
    render(
      <UsagePill
        {...pillProps(owner => {
          placements.push(owner.placement)
          return <span>{`$${owner.placement}`}</span>
        })}
      />,
    )

    expect(screen.getByText('$pill')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    for (const bucket of ['input', 'cacheRead', 'output']) {
      expect(screen.getByText(`$${bucket}`).closest('dd')).toBeTruthy()
    }
    expect(screen.queryByText('$cacheWrite')).toBeNull()
    expect(new Set(placements)).toEqual(new Set(['pill', 'input', 'cacheRead', 'output']))
  })

  it('renders the native pill unchanged without a contributor', () => {
    render(<UsagePill {...pillProps()} />)
    fireEvent.click(screen.getByRole('button'))
    expect(document.querySelectorAll('[data-session-stats-usage] dd')).toHaveLength(4)
  })
})
