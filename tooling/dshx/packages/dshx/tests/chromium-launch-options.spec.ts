import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chromiumLaunchOptions } from '../src/project/chromium-launch-options.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('installed Chromium launch options', () => {
  it('keeps Playwright bundled Chromium as the default', async () => {
    expect(await chromiumLaunchOptions({})).toEqual({})
  })

  it.each(['', 'google-chrome', '~/bin/chrome', './chrome'])('rejects a non-absolute override instead of silently falling back: %j', async value => {
    await expect(chromiumLaunchOptions({ DSHX_CHROMIUM_EXECUTABLE: value })).rejects.toThrow('DSHX_CHROMIUM_EXECUTABLE must name an absolute executable file')
  })

  it('requires an existing executable file and exposes only Playwright executablePath', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshx-chromium-options-'))
    roots.push(root)
    const file = join(root, 'installed-chrome')
    await writeFile(file, `#!${process.execPath}\n`)
    await chmod(file, 0o600)
    await expect(chromiumLaunchOptions({ DSHX_CHROMIUM_EXECUTABLE: join(root, 'missing') })).rejects.toThrow('existing executable file')
    await expect(chromiumLaunchOptions({ DSHX_CHROMIUM_EXECUTABLE: root })).rejects.toThrow('existing executable file')
    await expect(chromiumLaunchOptions({ DSHX_CHROMIUM_EXECUTABLE: file })).rejects.toThrow('execute permission')
    await chmod(file, 0o700)
    expect(await chromiumLaunchOptions({ DSHX_CHROMIUM_EXECUTABLE: file })).toEqual({ executablePath: file })
  })
})
