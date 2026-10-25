import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import {
  killScratchProcess,
  listScratchProcesses,
  parseElapsed,
  reapRecordedScratchProcesses,
  reapRecordedScratchProcessesFromLedgers,
  reapScratchProcesses,
  recordScratchProcess,
} from './reap-scratch-processes.mjs'

const run = promisify(execFile)

/** `node -e "…" <marker>` in a background shell: bash exits, so the node process is re-parented to pid 1. */
const spawnOrphan = async marker => {
  const { stdout } = await run('bash', ['-c', `node -e "setInterval(() => {}, 1000)" ${marker} </dev/null >/dev/null 2>&1 & echo $!`])
  return Number(stdout.trim())
}

const waitForOrphan = async (pid, patterns) => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const found = (await listScratchProcesses({ patterns })).find(entry => entry.pid === pid && entry.ppid === 1)
    if (found !== undefined) return found
    await new Promise(resolveWait => setTimeout(resolveWait, 50))
  }
  throw new Error(`process ${String(pid)} was never re-parented to pid 1`)
}

const isAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const tempLedger = suffix => join(tmpdir(), `dshx-reap-ledger-${String(process.pid)}-${suffix}.jsonl`)

test('parseElapsed reads the ps elapsed forms in milliseconds', () => {
  assert.equal(parseElapsed('00:57'), 57_000)
  assert.equal(parseElapsed('05:53:42'), 21_222_000)
  assert.equal(parseElapsed('01-22:19:59'), (24 * 3_600 + 22 * 3_600 + 19 * 60 + 59) * 1_000)
  assert.equal(parseElapsed('nonsense'), undefined)
})

test('the pattern sweep reaps only parentless processes older than the floor', async () => {
  const marker = `dshx-reap-test-marker-${String(process.pid)}`
  const patterns = [marker]
  const orphanPid = await spawnOrphan(marker)
  const owned = spawn('node', ['-e', 'setInterval(() => {}, 1000)', marker], { stdio: 'ignore', detached: false })
  try {
    await waitForOrphan(orphanPid, patterns)

    const tooYoung = await reapScratchProcesses({ patterns, minAgeMs: 60_000 })
    assert.deepEqual(tooYoung, [], 'a fresh orphan is left for the run that owns it')
    assert.ok(isAlive(orphanPid))

    const dryRun = await reapScratchProcesses({ patterns, minAgeMs: 0, dryRun: true })
    assert.deepEqual(
      dryRun.map(entry => entry.pid),
      [orphanPid],
      'a dry run reports without killing',
    )
    assert.ok(isAlive(orphanPid))

    const reaped = await reapScratchProcesses({ patterns, minAgeMs: 0 })
    assert.deepEqual(
      reaped.map(entry => entry.pid),
      [orphanPid],
      'the live child of this test is not an orphan',
    )
    assert.equal(isAlive(orphanPid), false, 'the orphan is gone')
    assert.ok(owned.pid !== undefined && isAlive(owned.pid), 'a process a live parent owns survives')
  } finally {
    if (owned.pid !== undefined) await killScratchProcess(owned.pid)
    if (isAlive(orphanPid)) await killScratchProcess(orphanPid)
  }
})

test('the ledger sweep reaps what this workspace recorded and leaves everything else alone', async () => {
  const marker = `dshx-reap-ledger-marker-${String(process.pid)}`
  const ledgerPath = tempLedger('recorded')
  const orphanPid = await spawnOrphan(marker)
  const unrecordedPid = await spawnOrphan(`${marker}-unrecorded`)
  const devPid = await spawnOrphan(`${marker}-lookalike-dev-host`)
  try {
    await waitForOrphan(orphanPid, [marker])
    await recordScratchProcess({ ledgerPath, pid: orphanPid, signature: marker })

    const dryRun = await reapRecordedScratchProcesses({ ledgerPath, minAgeMs: 0, dryRun: true })
    assert.deepEqual(
      dryRun.map(entry => entry.pid),
      [orphanPid],
    )
    assert.ok(isAlive(orphanPid))

    const reaped = await reapRecordedScratchProcesses({ ledgerPath, minAgeMs: 0 })
    assert.deepEqual(
      reaped.map(entry => entry.pid),
      [orphanPid],
      'a lookalike nobody recorded is never a candidate',
    )
    assert.equal(isAlive(orphanPid), false)
    assert.ok(isAlive(unrecordedPid) && isAlive(devPid), 'an unrecorded lookalike, which is what a live dshx dev Host looks like, survives')
  } finally {
    await rm(ledgerPath, { force: true })
    for (const pid of [orphanPid, unrecordedPid, devPid]) if (isAlive(pid)) await killScratchProcess(pid)
  }
})

test('the cross-workspace ledger sweep reaps only recorded orphan hosts from every ledger', async () => {
  const marker = `dshx-reap-cross-workspace-${String(process.pid)}`
  const firstLedger = tempLedger('cross-first')
  const secondLedger = tempLedger('cross-second')
  const orphanPid = await spawnOrphan(marker)
  const unrecordedPid = await spawnOrphan(`${marker}-unrecorded`)
  try {
    await waitForOrphan(orphanPid, [marker])
    await recordScratchProcess({ ledgerPath: secondLedger, pid: orphanPid, signature: marker })

    const preview = await reapRecordedScratchProcessesFromLedgers({ ledgerPaths: [firstLedger, secondLedger], minAgeMs: 0, dryRun: true })
    assert.deepEqual(
      preview.map(entry => entry.pid),
      [orphanPid],
    )
    assert.ok(isAlive(orphanPid), 'the preview leaves the recorded host running')

    const reaped = await reapRecordedScratchProcessesFromLedgers({ ledgerPaths: [firstLedger, secondLedger], minAgeMs: 0 })
    assert.deepEqual(
      reaped.map(entry => entry.pid),
      [orphanPid],
    )
    assert.equal(isAlive(orphanPid), false)
    assert.ok(isAlive(unrecordedPid), 'an unrecorded process in another workspace survives')
  } finally {
    await rm(firstLedger, { force: true })
    await rm(secondLedger, { force: true })
    for (const pid of [orphanPid, unrecordedPid]) if (isAlive(pid)) await killScratchProcess(pid)
  }
})

test('a recorded pid that no longer runs the recorded command is dropped, not killed', async () => {
  const marker = `dshx-reap-reuse-marker-${String(process.pid)}`
  const ledgerPath = tempLedger('reuse')
  const reused = spawn('node', ['-e', 'setInterval(() => {}, 1000)', marker], { stdio: 'ignore' })
  try {
    assert.ok(reused.pid !== undefined)
    await recordScratchProcess({ ledgerPath, pid: reused.pid, signature: 'a command line that is not running' })
    const reaped = await reapRecordedScratchProcesses({ ledgerPath, minAgeMs: 0 })
    assert.deepEqual(reaped, [], 'a reused pid is not proof of a leak')
    assert.ok(isAlive(reused.pid))
  } finally {
    await rm(ledgerPath, { force: true })
    if (reused.pid !== undefined) await killScratchProcess(reused.pid)
  }
})

test('an unwritable ledger never fails a run, and an absent ledger reaps nothing', async () => {
  await recordScratchProcess({ ledgerPath: join(tmpdir(), 'dshx-reap-missing-dir', 'nested', 'ledger.jsonl'), pid: 1, signature: 'x' })
  const reaped = await reapRecordedScratchProcesses({ ledgerPath: tempLedger('absent'), minAgeMs: 0 })
  assert.deepEqual(reaped, [])
})
