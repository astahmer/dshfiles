import { afterEach, describe, expect, it, vi } from 'vitest'
import { MistralAccountModel } from './mistral-account.js'
import { mistralTemplateId } from './mistral-provider.js'

const {
  noBudgetMessage: MISTRAL_NO_BUDGET_MESSAGE,
  fetchCatalog: fetchMistralCatalog,
  usageCard: mistralUsageCard,
  parseCatalog: parseMistralCatalog,
  parseVibeEnvKey,
  readKey: readMistralKey,
  readUsage: readMistralUsage,
  readVibeKey,
  vibeHome,
} = MistralAccountModel

const chat = { completion_chat: true, function_calling: true }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Mistral Vibe login reuse', () => {
  it('reads the key python-dotenv would read from ~/.vibe/.env', () => {
    expect(parseVibeEnvKey('# comment\nOTHER=1\nMISTRAL_API_KEY=plain\n')).toBe('plain')
    expect(parseVibeEnvKey("export MISTRAL_API_KEY='quoted # kept'\n")).toBe('quoted # kept')
    expect(parseVibeEnvKey('MISTRAL_API_KEY=abc # trailing\nMISTRAL_API_KEY="last"')).toBe('last')
    expect(parseVibeEnvKey('MISTRAL_API_KEY_OLD=x')).toBe('')
  })

  it('honours an absolute VIBE_HOME and ignores a relative one', () => {
    expect(vibeHome({ VIBE_HOME: '/srv/vibe' }, '/home/u')).toBe('/srv/vibe')
    expect(vibeHome({ VIBE_HOME: 'relative' }, '/home/u')).toBe('/home/u/.vibe')
    expect(vibeHome({}, '/home/u')).toBe('/home/u/.vibe')
  })

  it('prefers .env, then the macOS Keychain services newest first', async () => {
    const keychain = vi.fn(async (service: string) => (service === 'vibe' ? 'legacy-key' : ''))
    expect(await readVibeKey({ directory: '/v', readText: async () => 'MISTRAL_API_KEY=file-key', readKeychain: keychain, platform: 'darwin' })).toBe(
      'file-key',
    )
    expect(keychain).not.toHaveBeenCalled()
    const missing = async (): Promise<string> => {
      throw new Error('ENOENT')
    }
    expect(await readVibeKey({ directory: '/v', readText: missing, readKeychain: keychain, platform: 'darwin' })).toBe('legacy-key')
    expect(keychain.mock.calls.map(([service]) => service)).toEqual(['ai.mistral.vibe', 'vibe'])
    expect(await readVibeKey({ directory: '/v', readText: missing, readKeychain: keychain, platform: 'linux' })).toBe('')
  })

  it('keeps named references and the Vibe login apart', async () => {
    const resolve = async (name: string): Promise<string> => (name === 'MISTRAL_WORK_API_KEY' ? 'named' : '')
    const cli = async (): Promise<string> => 'vibe'
    expect(await readMistralKey('MISTRAL_WORK_API_KEY', resolve, 'reference', cli)).toBe('named')
    // A missing named key never borrows the Vibe login.
    expect(await readMistralKey('MISSING_API_KEY', resolve, 'reference', cli)).toBe('')
    // An explicit CLI choice never reads a reference.
    expect(await readMistralKey('MISTRAL_WORK_API_KEY', resolve, 'cli', cli)).toBe('vibe')
    // Legacy rows without a source keep the named-then-login fallback.
    expect(await readMistralKey('MISSING_API_KEY', resolve, undefined, cli)).toBe('vibe')
  })
})

describe('Mistral model catalog', () => {
  it('reads the Vibe plan catalog and keeps tool-capable chat models only', () => {
    expect(
      parseMistralCatalog({
        models: [
          { id: 'mistral-vibe-cli-latest', label: 'Vibe', max_context_length: 262144, capabilities: { ...chat, vision: true } },
          { id: 'mistral-embed', label: 'Embed', capabilities: { completion_chat: false } },
          { id: 'mistral-vibe-cli-latest', label: 'dup', capabilities: chat },
        ],
      }),
    ).toEqual([{ id: 'mistral-vibe-cli-latest', contextWindow: 262144, vision: true }])
  })

  it('falls back to the documented /v1/models shape and drops deprecated models', () => {
    expect(
      parseMistralCatalog({
        object: 'list',
        data: [
          { id: 'devstral-latest', capabilities: chat, max_context_length: null },
          { id: 'open-mistral-7b', capabilities: chat, deprecation: '2025-03-30T12:00:00Z' },
        ],
      }),
    ).toEqual([{ id: 'devstral-latest', vision: false }])
    expect(() => parseMistralCatalog({ unexpected: true })).toThrow()
  })

  it('uses /v1/models when the Vibe catalog is unavailable', async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes('model-catalog')
        ? new Response('missing', { status: 404 })
        : Response.json({ data: [{ id: 'mistral-medium-latest', capabilities: chat }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchMistralCatalog('key')).toEqual([{ id: 'mistral-medium-latest', vision: false }])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.mistral.ai/v1/model-catalog?surface=vibe-code',
      'https://api.mistral.ai/v1/models',
    ])
    await expect(fetchMistralCatalog('  ')).rejects.toThrow('vibe --setup')
  })

  it('templates discovered Vibe aliases on the matching catalog family', () => {
    const known = ['codestral-latest', 'devstral-latest', 'mistral-medium-latest', 'mistral-small-latest']
    expect(mistralTemplateId('mistral-vibe-cli-latest', known)).toBe('mistral-medium-latest')
    expect(mistralTemplateId('mistral-vibe-cli-fast', known)).toBe('mistral-small-latest')
    expect(mistralTemplateId('devstral-2604', known)).toBe('devstral-latest')
    expect(mistralTemplateId('unknown-model', known)).toBe('mistral-medium-latest')
  })

  it('templates a variant on its catalogued base model and GLM aliases on GLM 5.3', () => {
    const known = ['mistral-large-4', 'mistral-large-latest', 'mistral-medium-latest', 'zai-glm-5-2', 'zai-glm-5-3']
    expect(mistralTemplateId('mistral-large-4-0', known)).toBe('mistral-large-4')
    expect(mistralTemplateId('zai-glm-5-3-flash', known)).toBe('zai-glm-5-3')
    expect(mistralTemplateId('zai-glm-latest', known)).toBe('zai-glm-5-3')
  })
})

describe('Mistral plan quota', () => {
  it('maps the Vibe monthly budget to one window', () => {
    const card = mistralUsageCard({ plan_name: 'Pro', vibe_payg_enabled: false }, { vibe_budget: { usage_percentage: 42.5, reset_at: '2026-12-01T00:00:00Z' } })
    expect(card).toMatchObject({
      status: 'ok',
      plan: 'Pro',
      windows: [{ label: 'Monthly allowance', percentRemaining: 57.5, resetsAt: Date.parse('2026-12-01T00:00:00Z') }],
    })
  })

  it('reports an exhausted allowance as rate limited unless pay-as-you-go continues', () => {
    expect(mistralUsageCard(null, { vibe_budget: { usage_percentage: 130 } })).toMatchObject({
      status: 'rate-limited',
      windows: [{ percentRemaining: 0, resetsAt: null }],
    })
    expect(mistralUsageCard(null, { vibe_budget: { usage_percentage: 130, payg_enabled: true } }).status).toBe('ok')
  })

  it('never guesses a percentage when no budget is reported', () => {
    expect(mistralUsageCard({ plan_name: 'Scale' }, null)).toMatchObject({
      status: 'unsupported',
      message: MISTRAL_NO_BUDGET_MESSAGE,
      plan: 'Scale',
      windows: [],
    })
  })

  it('proves the key with /v1/models and reads billing best effort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const path = new URL(String(url)).pathname
        if (path === '/v1/models') return Response.json({ data: [] })
        if (path === '/v1/billing/subscription') return Response.json({ plan_name: 'Pro' })
        return new Response('forbidden', { status: 403 })
      }),
    )
    const onAuthenticated = vi.fn()
    const card = await readMistralUsage({ keyEnv: '', authSource: 'cli', readCliKey: async () => 'key', onAuthenticated })
    expect(onAuthenticated).toHaveBeenCalledOnce()
    expect(card).toMatchObject({ status: 'unsupported', plan: 'Pro' })
  })

  it('reports a rejected key as signed out without claiming authentication', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 401 })),
    )
    const onAuthenticated = vi.fn()
    expect(await readMistralUsage({ keyEnv: '', authSource: 'cli', readCliKey: async () => 'key', onAuthenticated })).toMatchObject({
      status: 'unauthenticated',
    })
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(await readMistralUsage({ keyEnv: '', authSource: 'cli', readCliKey: async () => '' })).toMatchObject({ status: 'unauthenticated' })
  })
})
