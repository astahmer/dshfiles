import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { ChromeLaunch } from '../src/chrome-launch.js'

describe('chromeExecutable', () => {
  it('honours a configured path that exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-chrome-'))
    const fake = join(directory, 'chrome')
    await writeFile(fake, '', 'utf8')
    expect(ChromeLaunch.chromeExecutable({ platform: 'darwin', configured: fake })).toBe(fake)
    await rm(directory, { recursive: true, force: true })
  })

  it('ignores a configured path that does not exist', () => {
    expect(ChromeLaunch.chromeExecutable({ platform: 'darwin', configured: '/nope/chrome' })).toBeUndefined()
  })

  it('finds a binary on PATH for linux', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-chrome-path-'))
    const fake = join(directory, 'google-chrome')
    await writeFile(fake, '', 'utf8')
    expect(ChromeLaunch.chromeExecutable({ platform: 'linux', pathValue: `${directory}:/usr/bin` })).toBe(fake)
    await rm(directory, { recursive: true, force: true })
  })

  it('returns nothing on an unknown platform without a configured path', () => {
    expect(ChromeLaunch.chromeExecutable({ platform: 'aix', pathValue: '' })).toBeUndefined()
  })
})

describe('defaultProfileDir', () => {
  it('uses the DSH home when it is set', () => {
    expect(ChromeLaunch.defaultProfileDir({ dshHome: '/tmp/dsh-home' })).toBe('/tmp/dsh-home/plugins/annotations/chrome-profile')
  })

  it('falls back to the user home', () => {
    expect(ChromeLaunch.defaultProfileDir({ dshHome: undefined })).toMatch(/plugins\/annotations\/chrome-profile$/)
  })
})

describe('freePort', () => {
  it('skips a port that a non-devtools listener already holds', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    const chosen = await ChromeLaunch.freePort({ start: address.port, attempts: 3 })
    expect(chosen).not.toBe(address.port)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
})

describe('launchChrome', () => {
  it('creates the profile directory before spawning', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-launch-'))
    const profileDir = join(directory, 'nested', 'chrome-profile')
    await expect(ChromeLaunch.launchChrome({ executable: '/bin/echo', port: 1, profileDir, timeoutMs: 300 })).rejects.toThrow(
      /Chrome exited right after launch|debugging port/,
    )
    expect(existsSync(profileDir)).toBe(true)
    await rm(directory, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('records the launch span and fails fast when no port opens', async () => {
    using recorder = recordSpans()
    await expect(ChromeLaunch.launchChrome({ executable: '/bin/echo', port: 1, profileDir: '/tmp/dsh-chrome-probe', timeoutMs: 300 })).rejects.toThrow(
      /Chrome exited right after launch|debugging port/,
    )
    expect(recorder.span('annotations launch chrome')).toBeDefined()
  })
})

describe('chromeArguments', () => {
  it('opens the configured start page', () => {
    const args = ChromeLaunch.chromeArguments({ port: 9222, profileDir: '/tmp/p', startUrl: ' http://localhost:3000/app ' })
    expect(args).toContain('http://localhost:3000/app')
    expect(args).not.toContain('about:blank')
  })

  it('falls back to a blank tab', () => {
    expect(ChromeLaunch.chromeArguments({ port: 9222, profileDir: '/tmp/p' }).at(-1)).toBe('about:blank')
    expect(ChromeLaunch.chromeArguments({ port: 9222, profileDir: '/tmp/p', startUrl: '  ' }).at(-1)).toBe('about:blank')
  })

  it('always pins the loopback port and the owned profile', () => {
    const args = ChromeLaunch.chromeArguments({ port: 9333, profileDir: '/tmp/owned' })
    expect(args).toContain('--remote-debugging-port=9333')
    expect(args).toContain('--user-data-dir=/tmp/owned')
  })

  it('keeps the OS keychain out of a fresh profile', () => {
    const args = ChromeLaunch.chromeArguments({ port: 9222, profileDir: '/tmp/p' })
    expect(args).toContain('--password-store=basic')
    expect(args).toContain('--use-mock-keychain')
  })

  it('adds headless only when asked', () => {
    expect(ChromeLaunch.chromeArguments({ port: 9222, profileDir: '/tmp/p' })).not.toContain('--headless=new')
    expect(ChromeLaunch.chromeArguments({ port: 9222, profileDir: '/tmp/p', headless: true })).toContain('--headless=new')
  })
})
