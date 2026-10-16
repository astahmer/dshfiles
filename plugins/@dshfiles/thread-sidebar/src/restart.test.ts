import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { createRestartController, readLaunchUrl } from './restart.js'

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
    let scheduledExit: (() => Promise<void>) | undefined
    const exitCodes: number[] = []
    let recoveryCaptured = false
    const env = testEnvironment(home)
    const controller = createRestartController(
      { appExit: code => exitCodes.push(code) },
      {
        env,
        recordRunningSessions: async () => {
          recoveryCaptured = true
        },
        scheduleExit: exit => {
          scheduledExit = exit
        },
      },
    )
    const requestPath = env.DSH_RESTART_REQUEST_PATH

    assert.deepEqual(await controller.request(), { accepted: true })
    assert.equal(await readFile(requestPath, 'utf8'), RUN_ID)
    assert.deepEqual(exitCodes, [])
    assert.equal(recoveryCaptured, false)
    assert.ok(scheduledExit)
    await scheduledExit()
    assert.equal(recoveryCaptured, true)
    assert.deepEqual(exitCodes, [75])
    await assert.rejects(controller.request(), /could not be scheduled/u)
    assert.deepEqual(exitCodes, [75])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a failed recovery snapshot cancels the managed restart request', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-restart-recovery-'))
  try {
    let scheduledExit: (() => Promise<void>) | undefined
    const exitCodes: number[] = []
    const failures: unknown[] = []
    const env = testEnvironment(home)
    const controller = createRestartController(
      { appExit: code => exitCodes.push(code) },
      {
        env,
        recordRunningSessions: async () => {
          throw new Error('recovery storage unavailable')
        },
        onExitFailure: error => failures.push(error),
        scheduleExit: exit => {
          scheduledExit = exit
        },
      },
    )

    await controller.request()
    assert.ok(scheduledExit)
    await scheduledExit()
    assert.deepEqual(exitCodes, [])
    assert.equal(failures.length, 1)
    await assert.rejects(readFile(env.DSH_RESTART_REQUEST_PATH), { code: 'ENOENT' })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('sidebar restart availability uses the DSHX API hook without a React Query provider', async () => {
  const sidebarShell = await readFile(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
  assert.match(sidebarShell, /useApiQuery\(threadSidebarRestartApi, 'availability'\)/u)
  assert.doesNotMatch(sidebarShell, /@dshfiles\/plugin-ui\/query/u)
})

test('hands out only a loopback launch URL the supervisor recorded', async () => {
  const home = await mkdtemp(join(tmpdir(), 'thread-sidebar-launch-url-'))
  try {
    assert.equal(await readLaunchUrl({ DSH_HOME: home }), null)
    await mkdir(join(home, 'runtime'))
    await writeFile(join(home, 'runtime', 'web-url'), 'http://127.0.0.1:3080/?token=abc\n')
    assert.equal(await readLaunchUrl({ DSH_HOME: home }), 'http://127.0.0.1:3080/?token=abc')
    await writeFile(join(home, 'runtime', 'web-url'), 'http://evil.example/?token=abc\n')
    assert.equal(await readLaunchUrl({ DSH_HOME: home }), null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
