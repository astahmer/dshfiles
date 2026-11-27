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

  // The merge with upstream 534773f0 added {bookmark} to the Stale group's text while the panel passed only {days}, so
  // the page printed "{bookmark}" literally.
  it('fills every placeholder of a string the Workspaces page interpolates', () => {
    const strings = english()
    const source = readFileSync(fileURLToPath(new URL('./panel.tsx', import.meta.url)), 'utf8')
    const missing: string[] = []
    for (const match of source.matchAll(/\bt\('(\w+)'(?:,\s*\{([^{}]*)\})?\)/gu)) {
      const key = match[1] ?? ''
      const given = new Set((match[2] ?? '').split(',').map(part => part.split(':')[0]?.trim() ?? '').filter(Boolean))
      for (const [, name] of (strings.get(key) ?? '').matchAll(/\{(\w+)\}/gu)) if (!given.has(name ?? '')) missing.push(`${key}: {${name}}`)
    }
    expect(missing).toEqual([])
  })
})
