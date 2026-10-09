import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { createRestartController } from './restart.js'

const RUN_ID = 'a53b44df-e873-4abb-2c6e-a92223ae2db9'

const testEnvironment = (home: string) => ({
  DSH_HOME: home,
  DSH_RESTART_RUN_ID: RUN_ID,
  DSH_RESTART_REQUEST_PATH: join(home, 'runtime', `dsh-web-restart-${RUN_ID}.request`),
})

test('restart availability requires both the launcher handoff and the DSH exit hook', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-restart-'))
  try {
    const env = testEnvironment(home)
    assert.equal(createRestartController({ appExit: () => undefined }, { env }).available, true)
    assert.equal(
      createRestartController({ appExit: () => undefined }, { env: { ...env, DSH_RESTART_REQUEST_PATH: join(home, 'other.request') } }).available,
      false,
    )
    assert.equal(createRestartController({}, { env }).available, false)

    let exitRequested = false
    const unmanaged = createRestartController(
      {
        appExit: () => {
          exitRequested = true
        },
      },
      { env: { ...env, DSH_RESTART_REQUEST_PATH: join(home, 'other.request') } },
    )
    await assert.rejects(unmanaged.request(), /not running under the managed restart launcher/u)
    assert.equal(exitRequested, false)
    await assert.rejects(readFile(env.DSH_RESTART_REQUEST_PATH), { code: 'ENOENT' })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('restart request writes one marker and schedules a distinct graceful exit code', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-restart-'))
  try {
    let scheduledExit: (() => void) | undefined
    const exitCodes: number[] = []
    const env = testEnvironment(home)
    const controller = createRestartController(
      { appExit: code => exitCodes.push(code) },
      {
        env,
        scheduleExit: exit => {
          scheduledExit = exit
        },
      },
    )
    const requestPath = env.DSH_RESTART_REQUEST_PATH

    assert.deepEqual(await controller.request(), { accepted: true })
    assert.equal(await readFile(requestPath, 'utf8'), RUN_ID)
    assert.deepEqual(exitCodes, [])
    assert.ok(scheduledExit)
    scheduledExit()
    assert.deepEqual(exitCodes, [75])
    await assert.rejects(controller.request(), /could not be scheduled/u)
    assert.deepEqual(exitCodes, [75])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('sidebar restart availability uses the DSHX API hook without a React Query provider', async () => {
  const sidebarShell = await readFile(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
  assert.match(sidebarShell, /useApiQuery\(threadSidebarRestartApi, 'availability'\)/u)
  assert.doesNotMatch(sidebarShell, /@dshfiles\/plugin-ui\/query/u)
})
