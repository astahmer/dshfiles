// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatViewSlotProps } from '../src/native/contract/slots.ts'
import { TurnNavigator } from '../src/native/chat/TurnNavigator.tsx'
import type { TurnRailItem } from '../src/native/chat/turn-rail-items.ts'

afterEach(cleanup)

const t: ChatViewSlotProps['t'] = key => key

const item = (turn: number): TurnRailItem => ({
  turn,
  prompt: `prompt ${String(turn)}`,
  response: '',
  seq: null,
  kind: 'prompt',
  mark: undefined,
  anchor: { kind: 'loaded', key: `node-${String(turn)}` },
})

const rail = (input: { readonly seenTurn: number | null }) =>
  render(<TurnNavigator items={[1, 2, 3].map(item)} activeTurn={1} busyTurn={null} onNavigate={() => {}} t={t} seenTurn={input.seenTurn} />)

describe('turn rail read boundary', () => {
  it('draws the boundary between the seen Turns and the unseen ones', () => {
    rail({ seenTurn: 1 })
    expect(screen.getByRole('separator', { name: 'chat.turnMap.unreadBoundary' }).dataset.seenBoundary).toBe('1')
  })

  it('draws nothing when every Turn is seen, still unseen, or the position is unknown', () => {
    for (const seenTurn of [null, 0, 3]) {
      rail({ seenTurn })
      expect(screen.queryByRole('separator', { name: 'chat.turnMap.unreadBoundary' })).toBeNull()
      cleanup()
    }
  })
})
