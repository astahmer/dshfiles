import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The English strings as written, keyed like the locale: the locale object itself is only readable through the Host. */
const english = (): ReadonlyMap<string, string> => {
  const source = readFileSync(fileURLToPath(new URL('./locales.ts', import.meta.url)), 'utf8')
  const block = source.slice(source.indexOf('const en = {'), source.indexOf('const zh = {'))
  const entries = new Map<string, string>()
  for (const match of block.matchAll(/^ {2}(\w+):\s*\n?\s*'((?:[^'\\]|\\.)*)',$/gmu)) entries.set(match[1] ?? '', match[2] ?? '')
  return entries
}

describe('jj-integration copy', () => {
  it('never writes a plural as "(s)"', () => {
    const offenders = [...english()].filter(([, text]) => text.includes('(s)')).map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('names thread states with the six shared words', () => {
    const strings = english()
    expect(strings.size).toBeGreaterThan(200)
    expect(strings.get('lifecycleRunning')).toBe('Working')
    expect(strings.get('lifecycleWaitingInput')).toBe('Needs you')
    expect(strings.get('lifecycleFinished')).toBe('Done')
    expect(strings.get('completedFilter')).toBe('Done')
    const retired = ['Active', 'Finished', 'Running', 'Completed', 'Waiting for input', 'Lifecycle']
    expect([...strings].filter(([, text]) => retired.includes(text)).map(([key]) => key)).toEqual([])
  })

  it('calls the page by the name its navigation uses', () => {
    expect(english().get('title')).toBe('Workspaces')
  })
})
