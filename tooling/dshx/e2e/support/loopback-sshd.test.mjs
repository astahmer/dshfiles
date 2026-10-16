import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { startLoopbackSshd } from './loopback-sshd.mjs'

test('scratch SSH alias uses only generated config and reconnects after loopback sshd restarts', { timeout: 30_000 }, async () => {
  const fixture = await startLoopbackSshd()
  const clientHome = join(fixture.scratchRoot, 'client-home')
  try {
    await mkdir(clientHome)
    const seeded = await fixture.seedClientHome(clientHome)
    const env = {
      ...process.env,
      HOME: clientHome,
      PATH: [seeded.hostPathPrefix, process.env.PATH].filter(Boolean).join(delimiter),
    }
    const connect = () => spawnSync('ssh', [fixture.targetAlias, 'printf alias-ok'], { encoding: 'utf8', env })

    const firstConnection = connect()
    assert.equal(firstConnection.status, 0, firstConnection.stderr)
    assert.equal(firstConnection.stdout, 'alias-ok')
    await fixture.stop()
    const disconnected = connect()
    assert.notEqual(disconnected.status, 0)
    await fixture.restart()
    const reconnected = connect()
    assert.equal(reconnected.status, 0, reconnected.stderr)
    assert.equal(reconnected.stdout, 'alias-ok')

    const wrapperInvocations = (await readFile(seeded.wrapperInvocationLogPath, 'utf8')).trim().split(/\r?\n/)
    assert.equal(wrapperInvocations.length, 3)
    await fixture.close()
    await assert.rejects(access(fixture.scratchRoot), { code: 'ENOENT' })
  } finally {
    await fixture.close()
  }
})
