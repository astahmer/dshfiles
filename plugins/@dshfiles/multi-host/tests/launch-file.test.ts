import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { launchFilePaths, parseRuntimeLaunch, removeLaunchFile, writeLaunchFile } from '../src/launch-file.js'

const homes: string[] = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

describe('runtime launch file', () => {
  test('round-trips a private launch record and removes only its own', async () => {
    const home = await mkdtemp(join(tmpdir(), 'multi-host-launch-'))
    homes.push(home)
    const path = await writeLaunchFile({ dshHome: home, launchUrl: 'http://127.0.0.1:43123/?token=launch-token-123456' })
    expect(path).toBe(launchFilePaths(home)[0])
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(parseRuntimeLaunch(await readFile(path, 'utf8'))).toEqual({ port: 43123, token: 'launch-token-123456' })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, launchUrl: 'http://127.0.0.1:1/?token=other-runtime-1', pid: process.pid + 1 }))
    await removeLaunchFile(path)
    expect(await readFile(path, 'utf8')).toContain('other-runtime-1')
  })

  test('overwrites insecure existing metadata, tightens modes, and removes its own record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'multi-host-launch-'))
    homes.push(home)
    const [path] = launchFilePaths(home)
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
    expect(parseRuntimeLaunch(content)).toEqual({ port: 43124, token: 'new-runtime-token-5678' })

    await removeLaunchFile(path)
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('removes a temporary token file when publishing fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'multi-host-launch-'))
    homes.push(home)
    const [path] = launchFilePaths(home)
    await mkdir(path, { recursive: true, mode: 0o700 })

    await expect(writeLaunchFile({ dshHome: home, launchUrl: 'http://127.0.0.1:43125/?token=cleanup-token-12345' })).rejects.toThrow()
    expect(await readdir(dirname(path))).toEqual(['launch.json'])
  })

  test('reads the supervisor web-url line and refuses anything that is not a loopback launch URL', () => {
    expect(parseRuntimeLaunch('http://127.0.0.1:3080/?token=abcdefgh123\n')).toEqual({ port: 3080, token: 'abcdefgh123' })
    expect(parseRuntimeLaunch('http://evil.example:3080/?token=abcdefgh123')).toBeUndefined()
    expect(parseRuntimeLaunch('{"schemaVersion":1,"launchUrl":"http://10.0.0.1:1/?token=abcdefgh123","pid":1}')).toBeUndefined()
    expect(parseRuntimeLaunch('')).toBeUndefined()
  })
})
