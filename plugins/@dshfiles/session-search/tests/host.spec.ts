import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

const idleHealth = { behindSessions: 0, behindBytes: 0, ingesting: false, lastIngestMs: 0, lastError: null }

describe('owned index document rows', () => {
  const sessionId = 'session-dddddddd-0000-4000-8000-000000000000'
  const header = { id: sessionId, version: 4, createdAt: 1, isSeeded: false }
  const cursor = { logPath: '/log', dev: '1', ino: '2', offset: 10, size: 10, mtimeNs: '3' }
  const document = (seq: number, text: string) => ({ sessionId, seq, type: 'user/message', time: seq, surface: 'current', text, truncated: false })

  it('reports the stored document count across append, replace and forget', () => {
    const index = new SearchIndex(join(root, 'index.sqlite'))
    index.commitBatch({ header, cursor, documents: [document(1, 'first note')], replace: false, now: 1 })
    expect(index.health(idleHealth)).toMatchObject({ sessions: 1, documents: 1 })
    index.commitBatch({ header, cursor: { ...cursor, offset: 20, size: 20 }, documents: [document(2, 'second note')], replace: false, now: 2 })
    expect(index.health(idleHealth).documents).toBe(2)
    index.commitBatch({ header, cursor, documents: [document(3, 'replacement note')], replace: true, now: 3 })
    expect(index.health(idleHealth).documents).toBe(1)
    expect(index.searchSessions({ query: 'first', limit: 5 }).matches).toHaveLength(0)
    index.forget(sessionId)
    expect(index.health(idleHealth)).toMatchObject({ sessions: 0, documents: 0 })
    expect(index.searchSessions({ query: 'replacement', limit: 5 }).matches).toHaveLength(0)
    index.close()
  })

  it('removes a replaced session that predates the rowid mapping', () => {
    const database = new DatabaseSync(join(root, 'index.sqlite'))
    database.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, created_at INTEGER NOT NULL, cwd TEXT, parent_session TEXT,
        seed_length INTEGER, delegation_depth INTEGER, agent_preset TEXT, log_path TEXT NOT NULL, log_dev TEXT NOT NULL,
        log_ino TEXT NOT NULL, log_offset INTEGER NOT NULL, log_size INTEGER NOT NULL, log_mtime_ns TEXT NOT NULL,
        indexed_at INTEGER NOT NULL, documents_count INTEGER NOT NULL DEFAULT 0, truncated_documents INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE VIRTUAL TABLE session_documents USING fts5(
        text, session_id UNINDEXED, seq UNINDEXED, type UNINDEXED, time UNINDEXED, surface UNINDEXED, truncated UNINDEXED,
        tokenize = 'unicode61'
      );
    `)
    database.exec(`INSERT INTO sessions VALUES ('${sessionId}', 4, 1, NULL, NULL, NULL, NULL, NULL, '/log', '1', '2', 10, 10, '3', 1, 1, 0)`)
    database.exec(
      `INSERT INTO session_documents (text, session_id, seq, type, time, surface, truncated) VALUES ('stale note', '${sessionId}', 1, 'user/message', 1, 'current', 0)`,
    )
    database.close()

    const index = new SearchIndex(join(root, 'index.sqlite'))
    expect(index.health(idleHealth).documents).toBe(1)
    index.forget(sessionId)
    expect(index.searchSessions({ query: 'stale', limit: 5 }).matches).toHaveLength(0)
    index.commitBatch({ header, cursor, documents: [document(1, 'fresh note')], replace: true, now: 1 })
    expect(index.searchSessions({ query: 'fresh', limit: 5 }).matches).toHaveLength(1)
    expect(index.health(idleHealth).documents).toBe(1)
    index.close()
  })
})
