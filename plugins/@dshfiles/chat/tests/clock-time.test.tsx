// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { formatClockTime } from '@dshfiles/plugin-ui/lib/format-clock-time'
import { afterEach, describe, expect, it } from 'vitest'
import { formatMessageClock } from '../src/native/chat/message-chrome.ts'
import { ReasoningTiming } from '../src/native/chat/ReasoningTiming.tsx'

afterEach(cleanup)

// Council round 5 (A6): the transcript forced a 24-hour clock while AI accounts and Backlog printed the locale's own;
// every clock time now goes through the kit's one formatter.
const at = new Date(2026, 10, 25, 21, 13).getTime()
const t = ((key: string, params?: { readonly y?: number; readonly m?: number; readonly d?: number }) =>
  key === 'clock.md' ? `${String(params?.m)}/${String(params?.d)}` : `${String(params?.y)}/${String(params?.m)}/${String(params?.d)}`) as never

describe('clock times in the transcript (round five A6)', () => {
  it("prints a message's time the way the kit's formatter does for the locale", () => {
    expect(formatMessageClock(at, t, at + 60_000)).toBe(formatClockTime(at))
    expect(formatMessageClock(at, t, at + 3 * 86_400_000)).toBe(`11/25 ${formatClockTime(at)}`)
  })

  it("prints a reasoning block's start time the same way", () => {
    const { container } = render(<ReasoningTiming timing={{ startedAt: at, endedAt: at + 2_000 }} t={t} />)
    expect(container.textContent).toContain(formatClockTime(at))
  })
})
