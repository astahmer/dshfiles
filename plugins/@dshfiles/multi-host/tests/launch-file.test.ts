import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { LaunchFile, RuntimeLaunchFile } from '../src/launch-file.js'
import { dataRunner } from './fixtures/data-runtime.js'

const homes: string[] = []
const runner = dataRunner({ DSH_HOME: '/nonexistent/multi-host-launch-file-test' })
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const writeLaunchFile = (input: { readonly dshHome: string; readonly launchUrl: string }) => runner.run(LaunchFile.use(launchFile => launchFile.write(input)))
const removeLaunchFile = (path: string) => runner.run(LaunchFile.use(launchFile => launchFile.removeIfOwned(path)))

describe('runtime launch file', () => {
  test('releases its exit listener on every reload', async () => {
    const home = await mkdtemp(join(tmpdir(), 'multi-host-launch-'))
    homes.push(home)
    const reloads = dataRunner({ DSH_HOME: home })
    const exitListenersBefore = process.listenerCount('exit')
    for (const port of [43125, 43126, 43127]) {
      await reloads.run(Effect.scoped(LaunchFile.use(launchFile => launchFile.publish(`http://127.0.0.1:${port}/?token=reload-token-123456`))))
    }
    await reloads.dispose()
    expect(process.listenerCount('exit')).toBe(exitListenersBefore)
    await expect(readFile(RuntimeLaunchFile.launchFilePaths(home)[0], 'utf8')).rejects.toThrow('ENOENT')
  })

  test('round-trips a private launch record and removes only its own', async () => {
    const home = await mkdtemp(join(tmpdir(), 'multi-host-launch-'))
    homes.push(home)
    const path = await writeLaunchFile({ dshHome: home, launchUrl: 'http://127.0.0.1:43123/?token=launch-token-123456' })
    expect(path).toBe(RuntimeLaunchFile.launchFilePaths(home)[0])
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(RuntimeLaunchFile.parseRuntimeLaunch(await readFile(path, 'utf8'))).toEqual({ port: 43123, token: 'launch-token-123456' })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, launchUrl: 'http://127.0.0.1:1/?token=other-runtime-1', pid: process.pid + 1 }))
    await removeLaunchFile(path)
    expect(await readFile(path, 'utf8')).toContain('other-runtime-1')
  })

  test('overwrites insecure existing metadata, tightens modes, and removes its own record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'multi-host-launch-'))
    homes.push(home)
    const [path] = RuntimeLaunchFile.launchFilePaths(home)
    const directory = dirname(path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o777)
    await writeFile(path, JSON.stringify({ schemaVersion: 1, launchUrl: 'http://127.0.0.1:43123/?token=old-runtime-token-1234', pid: process.pid + 1 }), {
      mode: 0o644,
    })
    await chmod(path, 0o644)

    await writeLaunchFile({ dshHome: home, launchUrl: 'http://127.0.0.1:43124/?token=new-runtime-token-5678' })

    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const content = await readFile(path, 'utf8')
    expect(content).not.toContain('old-runtime-token-1234')
    expect(RuntimeLaunchFile.parseRuntimeLaunch(content)).toEqual({ port: 43124, token: 'new-runtime-token-5678' })

    await removeLaunchFile(path)
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('removes a temporary token file when publishing fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'multi-host-launch-'))
    homes.push(home)
    const [path] = RuntimeLaunchFile.launchFilePaths(home)
    await mkdir(path, { recursive: true, mode: 0o700 })

    await expect(writeLaunchFile({ dshHome: home, launchUrl: 'http://127.0.0.1:43125/?token=cleanup-token-12345' })).rejects.toThrow()
    expect(await readdir(dirname(path))).toEqual(['launch.json'])
  })

  test('reads the supervisor web-url line and refuses anything that is not a loopback launch URL', () => {
    expect(RuntimeLaunchFile.parseRuntimeLaunch('http://127.0.0.1:3080/?token=abcdefgh123\n')).toEqual({ port: 3080, token: 'abcdefgh123' })
    expect(RuntimeLaunchFile.parseRuntimeLaunch('http://evil.example:3080/?token=abcdefgh123')).toBeUndefined()
    expect(RuntimeLaunchFile.parseRuntimeLaunch('{"schemaVersion":1,"launchUrl":"http://10.0.0.1:1/?token=abcdefgh123","pid":1}')).toBeUndefined()
    expect(RuntimeLaunchFile.parseRuntimeLaunch('')).toBeUndefined()
  })
})
