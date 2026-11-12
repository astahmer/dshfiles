import { describe, expect, it } from 'vitest'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { countsText } from './stats-counts.ts'
import { en } from '../locale.ts'

const dictionary: Readonly<Record<string, string>> = en

const translate = (key: string, params?: Record<string, string | number>): string =>
  (dictionary[key] ?? key).replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? ''))
// SAFETY: translate accepts every key and parameter record the chat namespace's typed translator accepts.
const t = translate as unknown as ChatViewSlotProps['t']

describe('composer activity counts (b:gyk7)', () => {
  it('names each unit in the right number', () => {
    expect(countsText({ turns: 1, steps: 1 }, t)).toBe('1 turn · 1 step')
    expect(countsText({ turns: 1, steps: 3 }, t)).toBe('1 turn · 3 steps')
    expect(countsText({ turns: 2, steps: 5 }, t)).toBe('2 turns · 5 steps')
  })
})
