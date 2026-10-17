import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'vitest'
import { activeRestartSessionIds, createRestartRecoveryStore } from './restart-recovery.js'

test('restart capture includes only Agents still running at the exit boundary', () => {
  assert.deepEqual(
    activeRestartSessionIds([
      { id: 'working', status: 'running' },
      { id: 'finished', status: 'idle' },
      { id: 'user-cancelled', status: 'idle' },
      { id: 'working', status: 'running' },
    ]),
    ['working'],
  )
})

test('restart recovery entries survive Host replacement and dedupe later restart captures', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-recovery-'))
  let sequence = 0
  const createStore = () =>
    createRestartRecoveryStore({
      home,
      now: () => 100 + sequence,
      requestId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    })
  try {
    const beforeRestart = createStore()
    await beforeRestart.record(['active', 'active'], 'restart')
    await beforeRestart.record(['active', 'another-active'], 'restart')

    const afterRestart = createStore()
    const entries = await afterRestart.list()
    assert.deepEqual(
      entries.map(entry => entry.sessionId),
      ['active', 'another-active'],
    )
    assert.equal(entries[0]?.requestId, '00000000-0000-4000-8000-000000000001')
    assert.equal(entries[0]?.interruptedAt, 101)

    await afterRestart.complete('active')
    assert.deepEqual(
      (await createStore().list()).map(entry => entry.sessionId),
      ['another-active'],
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('concurrent restart snapshots keep every unique recovery candidate', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-recovery-'))
  try {
    const store = createRestartRecoveryStore({ home })
    await Promise.all([store.record(['first', 'shared'], 'restart'), store.record(['second', 'shared'], 'restart')])
    assert.deepEqual((await store.list()).map(entry => entry.sessionId).sort(), ['first', 'second', 'shared'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('dismiss removes one recovery candidate without changing other entries', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-recovery-'))
  try {
    const store = createRestartRecoveryStore({ home })
    await store.record(['finished-later', 'still-needs-resume'], 'restart')
    await store.dismiss('finished-later')
    const path = join(home, 'runtime', 'thread-sidebar-recoveries.json')
    assert.match(await readFile(path, 'utf8'), /still-needs-resume/u)
    assert.doesNotMatch(await readFile(path, 'utf8'), /finished-later/u)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a recovery file written before reasons existed reads as managed restarts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-recovery-'))
  try {
    const path = join(home, 'runtime', 'thread-sidebar-recoveries.json')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({ version: 1, entries: [{ sessionId: 'older-entry', requestId: '00000000-0000-4000-8000-000000000001', interruptedAt: 7 }] })}\n`,
    )
    const entries = await createRestartRecoveryStore({ home }).list()
    assert.deepEqual(
      entries.map(entry => [entry.sessionId, entry.reason]),
      [['older-entry', 'restart']],
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
