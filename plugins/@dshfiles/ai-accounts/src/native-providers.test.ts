import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readNativeProviders, setNativeProviderEnabled } from './native-providers.js'

const original = `- id: llm-commandcode\n  config:\n    apiKeyEnv: COMMANDCODE_API_KEY\n`

interface FakeRow {
  options: { id: string; name: string }
  disabled: boolean
  fiber: object | undefined
}

let dir = ''
let patchPath = ''
let rows: FakeRow[] = []
let directory: { provider: string; displayName: string; settingsNs: string; settingsPath: string[] }[] = []

const host = (): Context => {
  const ctx = new Context()
  for (const name of ['profileContext', 'loader', 'llm']) ctx.provide(name)
  ctx.set('profileContext', { patchPath })
  ctx.set('loader', { entries: () => rows })
  ctx.set('llm', { listConfigurableProviders: () => directory })
  return ctx
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-accounts-native-'))
  patchPath = join(dir, 'cordis.patch.yml')
  await writeFile(patchPath, original)
  rows = [
    { options: { id: 'llm-commandcode', name: '@mars-sea/dsh-commandcode-provider' }, disabled: false, fiber: {} },
    { options: { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek-api-key' }, disabled: false, fiber: {} },
    { options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' }, disabled: false, fiber: {} },
    { options: { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }, disabled: false, fiber: {} },
  ]
  directory = [
    { provider: 'commandcode', displayName: 'Command Code', settingsNs: 'llm-commandcode', settingsPath: [] },
    { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
    { provider: 'minimax', displayName: 'MiniMax', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'minimax'] },
    { provider: 'codex', displayName: 'Codex', settingsNs: 'ai-accounts.codex.codex', settingsPath: [] },
  ]
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('native provider switch', () => {
  it('lists only native provider rows, not shared or own rows', async () => {
    const state = await readNativeProviders(host())
    expect(state.available).toBe(true)
    expect(state.liveReload).toBe(false)
    expect(state.providers.map(provider => [provider.entryId, provider.label, provider.enabled, provider.running])).toEqual([
      ['llm-commandcode', 'Command Code', true, true],
      ['llm-deepseek', 'DeepSeek', true, true],
    ])
  })

  it('turns a row off and back on without touching its config, and keeps listing it while off', async () => {
    const ctx = host()
    const off = await setNativeProviderEnabled(ctx, { entryId: 'llm-commandcode', enabled: false })
    expect(off.providers.find(provider => provider.entryId === 'llm-commandcode')).toMatchObject({ enabled: false, running: true })
    expect(await readFile(patchPath, 'utf8')).toContain(original)

    // The Loader applies the patch: the row stops and its routes leave the directory.
    rows[0] = { ...rows[0]!, disabled: true, fiber: undefined }
    directory = directory.filter(provider => provider.settingsNs !== 'llm-commandcode')
    expect((await readNativeProviders(ctx)).providers.find(provider => provider.entryId === 'llm-commandcode')).toMatchObject({
      label: 'Command Code',
      enabled: false,
      running: false,
      lockedReason: null,
    })

    const on = await setNativeProviderEnabled(ctx, { entryId: 'llm-commandcode', enabled: true })
    expect(on.providers.find(provider => provider.entryId === 'llm-commandcode')).toMatchObject({ enabled: true, running: false, lockedReason: null })
    expect(await readFile(patchPath, 'utf8')).toBe(original)
  })

  it('refuses rows it does not list and rows disabled by someone else', async () => {
    const ctx = host()
    await expect(setNativeProviderEnabled(ctx, { entryId: 'tool-bash', enabled: false })).rejects.toThrow(/not a native provider/)
    await expect(setNativeProviderEnabled(ctx, { entryId: 'llm-pi-ai', enabled: false })).rejects.toThrow(/not a native provider/)
    rows[1] = { ...rows[1]!, disabled: true, fiber: undefined }
    const state = await readNativeProviders(ctx)
    expect(state.providers.find(provider => provider.entryId === 'llm-deepseek')?.lockedReason).toMatch(/another entry/)
    await expect(setNativeProviderEnabled(ctx, { entryId: 'llm-deepseek', enabled: true })).rejects.toThrow(/another entry/)
  })

  it('reports unavailable on a Host without a profile patch', async () => {
    const state = await readNativeProviders(new Context())
    expect(state).toMatchObject({ available: false, providers: [] })
  })
})
