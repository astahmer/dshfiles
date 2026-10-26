import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chromiumLaunchOptions } from '../../packages/dshx/src/project/chromium-launch-options.js'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.resetModules()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('shared system Chromium selection', () => {
  it('passes the selected executable to normal and persistent launches without starting a real browser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshx-chromium-argv-'))
    roots.push(root)
    const capture = join(root, 'argv.jsonl')
    const fakeChrome = join(root, 'fake-chrome')
    await writeFile(
      fakeChrome,
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)) + '\\n'); process.exit(1)\n`,
    )
    await chmod(fakeChrome, 0o700)
    vi.stubEnv('DSHX_CHROMIUM_EXECUTABLE', fakeChrome)
    const options = { ...(await chromiumLaunchOptions()), headless: true, timeout: 2_000 }
    // The executable records Playwright's argv, then exits rather than implementing a browser transport.
    await expect(chromium.launch(options)).rejects.toThrow()
    const userDataDir = join(root, 'isolated-browser-profile')
    await expect(chromium.launchPersistentContext(userDataDir, { ...options, args: ['--remote-debugging-port=0'] })).rejects.toThrow()
    const captures: string[][] = (await readFile(capture, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(captures).toHaveLength(2)
    expect(captures[0]).toContain('--headless')
    expect(captures[1]).toContain('--headless')
    expect(captures[1]).toContain(`--user-data-dir=${userDataDir}`)
    expect(captures[1]).toContain('--remote-debugging-port=0')
  })

  it('configures the actual Chromium E2E project with the same validated executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshx-chromium-config-'))
    roots.push(root)
    const fakeChrome = join(root, 'fake-chrome')
    await writeFile(fakeChrome, `#!${process.execPath}\n`)
    await chmod(fakeChrome, 0o700)
    vi.stubEnv('DSHX_CHROMIUM_EXECUTABLE', fakeChrome)
    const { default: config } = await import('../../playwright.e2e.config.js')
    const project = config.projects?.find(candidate => candidate.name === 'chromium')
    expect(project?.use?.launchOptions).toEqual({ executablePath: fakeChrome })
    expect(project?.use?.browserName).toBe('chromium')
  })
})
