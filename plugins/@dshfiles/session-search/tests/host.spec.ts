import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SearchIndex } from '../src/index-db.js'
import { FrameLog } from '../src/frame-log.js'
import { DocumentText } from '../src/text.js'
import { writeSessionLog } from './session-log-fixture.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'session-search-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('frame container reader', () => {
  it('decodes the same text when it resumes from a stored offset', async () => {
    const path = await writeSessionLog({ directory: join(root, 'project', 'session-aaaaaaaa-0000-4000-8000-000000000000'), exchanges: 12 })
    const buffer = await import('node:fs/promises').then(fs => fs.readFile(path))
    const whole = FrameLog.decodeFrom(buffer)
    const frames = FrameLog.scan(buffer)
    expect(frames.length).toBeGreaterThan(1)
    const first = FrameLog.decodeFrom(buffer, 0)
    const resumed = FrameLog.decodeFrom(buffer, frames[0]?.end ?? 0)
    expect(first.text.length + resumed.text.length).toBeGreaterThan(0)
    expect(whole.text).toContain('exchange 1')
    expect(whole.offset).toBe(frames.at(-1)?.end)
  })

  it('reads the header from the first frame', async () => {
    const directory = join(root, 'project', 'session-bbbbbbbb-0000-4000-8000-000000000000')
    const path = await writeSessionLog({ directory, exchanges: 2 })
    const header = await FrameLog.readHeader(path)
    expect(header.id).toBe('session-bbbbbbbb-0000-4000-8000-000000000000')
    const logs = await FrameLog.list(root)
    expect(logs.map(log => log.sessionId)).toEqual(['session-bbbbbbbb-0000-4000-8000-000000000000'])
  })
})

describe('bounded documents', () => {
  it('caps conversation text far above tool payloads', () => {
    expect(DocumentText.capFor('user/message')).toBeGreaterThan(DocumentText.capFor('tool/result'))
    expect(DocumentText.capFor('unknown/type')).toBe(4_096)
    const truncated = DocumentText.truncate('a'.repeat(100), 10)
    expect(truncated.text).toHaveLength(10)
    expect(truncated.truncated).toBe(true)
  })

  it('builds a plain snippet around the match', () => {
    const snippet = DocumentText.snippet(`${'\uFDD0'}needle${'\uFDD1'} and ${'x'.repeat(400)}`, 40)
    expect(snippet).toContain('needle')
    expect(Array.from(snippet).length).toBeLessThanOrEqual(40)
  })
})

describe('owned index', () => {
  it('answers a session search from stored documents', () => {
    const index = new SearchIndex(join(root, 'index.sqlite'))
    index.commitBatch({
      header: { id: 'session-cccccccc-0000-4000-8000-000000000000', version: 4, createdAt: 1, isSeeded: false },
      cursor: { logPath: join(root, 'log'), dev: '1', ino: '2', offset: 10, size: 10, mtimeNs: '3' },
      documents: [
        {
          sessionId: 'session-cccccccc-0000-4000-8000-000000000000',
          seq: 1,
          type: 'user/message',
          time: 1,
          surface: 'current',
          text: 'the retry storm must be capped',
          truncated: false,
        },
      ],
      replace: false,
      now: 1,
    })
    const page = index.searchSessions({ query: 'retry storm', limit: 5 })
    expect(page.matches).toHaveLength(1)
    expect(page.matches[0]?.snippet).toContain('retry')
    expect(index.searchSessions({ query: 'absent', limit: 5 }).matches).toHaveLength(0)
    index.close()
  })
})
