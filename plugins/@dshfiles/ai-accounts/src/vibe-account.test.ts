import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VibeAccountModel } from './vibe-account.js'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  delete process.env['VIBE_HOME']
})

const home = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'vibe-account-'))
  directories.push(directory)
  return directory
}

describe('Vibe account catalog', () => {
  it('lists every model Vibe 3.1.5 serves, with its own aliases and thinking levels', () => {
    expect(VibeAccountModel.models.map(model => model.id)).toEqual([
      'mistral-large-4-0',
      'mistral-medium-latest',
      'zai-glm-5-3',
      'zai-glm-5-3-flash',
      'deepseek-v4-1-flash-1017',
    ])
    expect(VibeAccountModel.models.find(model => model.id === 'mistral-medium-latest')?.aliases).toContain('mistral-vibe-cli-latest')
    expect(VibeAccountModel.models.find(model => model.id === 'zai-glm-5-3')?.thinking).toEqual(['low', 'high', 'max'])
  })

  it('resolves an alias to the model id `vibe --model` also accepts', () => {
    expect(VibeAccountModel.canonicalModelId('mistral-vibe-cli-latest')).toBe('mistral-medium-latest')
    expect(VibeAccountModel.canonicalModelId(' glm-5-3 ')).toBe('zai-glm-5-3')
    expect(VibeAccountModel.canonicalModelId('deepseek-v4-1-flash-1017')).toBe('deepseek-v4-1-flash-1017')
    expect(VibeAccountModel.canonicalModelId('some-future-model')).toBe('some-future-model')
  })

  it('maps pi-ai levels onto the levels the CLI lists, and leaves the rest unset', () => {
    expect(VibeAccountModel.thinkingLevelMap(['low', 'high', 'max'])).toMatchObject({
      low: 'low',
      high: 'high',
      max: 'max',
      medium: null,
      minimal: null,
      off: null,
      xhigh: null,
    })
  })
})

describe('Vibe account home and login', () => {
  it('uses the account folder, ~/.vibe for an empty home, and $VIBE_HOME when it is absolute', () => {
    process.env['VIBE_HOME'] = join(homedir(), 'synthetic-vibe-home')
    expect(VibeAccountModel.resolveHome('')).toBe(join(homedir(), 'synthetic-vibe-home'))
    expect(VibeAccountModel.resolveHome('~/.vibe')).toBe(join(homedir(), '.vibe'))
    expect(VibeAccountModel.resolveHome('~/.vibe-work')).toBe(join(homedir(), '.vibe-work'))
    expect(VibeAccountModel.resolveHome('/synthetic/vibe')).toBe('/synthetic/vibe')
    process.env['VIBE_HOME'] = 'relative-ignored'
    expect(VibeAccountModel.resolveHome('')).toBe(join(homedir(), '.vibe'))
  })

  it('reads the login `vibe --setup` stored in the account folder', async () => {
    const directory = home()
    expect(await VibeAccountModel.signedIn(directory, async () => '')).toBe(false)
    writeFileSync(join(directory, '.env'), 'MISTRAL_API_KEY=synthetic-login\n')
    await expect(VibeAccountModel.signedIn(directory, async () => 'synthetic-login')).resolves.toBe(true)
  })

  it('reports a signed-out route as unauthenticated with the sign-in command, never a guessed quota', async () => {
    const card = await VibeAccountModel.readUsage({ homePath: home(), readCliKey: async () => '' })
    expect(card.status).toBe('unauthenticated')
    expect(card.message).toContain('vibe --setup')
    expect(card.windows).toEqual([])
  })
})
