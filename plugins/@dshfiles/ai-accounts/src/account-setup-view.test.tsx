// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError, type ApiClient, type ApiContract } from '@dshfiles/dshx/api'
import { createApiClient } from '@dshfiles/dshx/api/client'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { AccountDraftModel } from './account-draft.js'
import { AccountConnectionMethodModel } from './account-connection-method.js'
import { aiAccountsLoginApi } from './account-login-api.js'
import { aiAccountsApi, accountProfileSchema, type AccountConnectionSnapshot, type AccountKind, type AccountsFile } from './api.js'
import { aiAccountsKeys } from './accounts-queries.js'
import { createAccountSetupController } from './account-setup-controller.js'
import { AccountSetupOverlay } from './account-setup-dialog.js'
import type { CredentialSetupPort } from './credential-setup-port.js'

type AccountsClient = typeof aiAccountsApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never
type LoginClient = typeof aiAccountsLoginApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never
const login = vi.hoisted(() => ({
  status: vi.fn<LoginClient['status']>(),
  begin: vi.fn<LoginClient['begin']>(),
  cancel: vi.fn<LoginClient['cancel']>(),
}))
const host = vi.hoisted(() => ({
  copilotLoginStatus: vi.fn<AccountsClient['copilotLoginStatus']>(),
  beginCopilotLogin: vi.fn<AccountsClient['beginCopilotLogin']>(),
  cancelCopilotLogin: vi.fn<AccountsClient['cancelCopilotLogin']>(),
  read: vi.fn<AccountsClient['read']>(),
  prepareAccountConnection: vi.fn<AccountsClient['prepareAccountConnection']>(),
  getAccountConnection: vi.fn<AccountsClient['getAccountConnection']>(),
  configureAccountConnection: vi.fn<AccountsClient['configureAccountConnection']>(),
  completeAccountConnection: vi.fn<AccountsClient['completeAccountConnection']>(),
  discardAccountConnection: vi.fn<AccountsClient['discardAccountConnection']>(),
  stageAccountConnectionKey: vi.fn<AccountsClient['stageAccountConnectionKey']>(),
  importAccountConnectionKey: vi.fn<AccountsClient['importAccountConnectionKey']>(),
  secretCatalogKeys: vi.fn<AccountsClient['secretCatalogKeys']>(),
}))
vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: (contract: typeof aiAccountsApi | typeof aiAccountsLoginApi) => (contract === aiAccountsLoginApi ? login : host),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ writeClipboard: vi.fn(async () => undefined) }))

const deferred = <Value,>() => {
  let settle: ((value: Value) => void) | undefined
  let fail: ((reason: Error) => void) | undefined
  const promise = new Promise<Value>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return {
    promise,
    resolve: (value: Value): void => {
      if (settle === undefined) throw new Error('Deferred result was not initialized')
      settle(value)
    },
    reject: (reason: Error): void => {
      if (fail === undefined) throw new Error('Deferred result was not initialized')
      fail(reason)
    },
  }
}

const profile = (kind: AccountKind = 'claude') =>
  accountProfileSchema.parse({
    ...AccountDraftModel.newAccountDraft({ kind, existing: [] }),
    instanceId: 'pending-account',
    displayName: 'Synthetic Claude',
    apiKeyEnv: kind === 'claude' || kind === 'codex' || kind === 'github-copilot' ? '' : 'SYNTHETIC_API_KEY',
    homePath: kind === 'claude' || kind === 'codex' ? `/synthetic/${kind}/shared` : '',
    shadowHomePath: kind === 'codex' ? '/synthetic/codex/auth' : '',
    mode: 'direct',
    signedIn: false,
    identity: null,
    plan: null,
    state: 'unconfigured',
    // Synthetic Host metadata, not a client-generated command or a real auth-file read.
    loginHint:
      kind === 'claude'
        ? 'CLAUDE_CONFIG_DIR="/synthetic/claude/shared" claude auth login'
        : kind === 'codex'
          ? 'CODEX_HOME="/synthetic/codex/auth" codex login'
          : kind === 'commandcode'
            ? 'cmd login'
            : kind === 'cursor'
              ? 'cursor-agent login'
              : '',
    detail: null,
  })
const pending = (operationId: string, kind: AccountKind = 'claude'): AccountConnectionSnapshot => ({
  operationId,
  instanceId: 'pending-account',
  status: 'pending',
  method: AccountConnectionMethodModel.defaultMethod(kind),
  expiresAt: Date.now() + 60_000,
  account: profile(kind),
})
const savedFile: AccountsFile = { distribution: 'sticky', cooldownMs: 0, shadowRoot: '/synthetic/shadows', accounts: [] }
const operations = new Map<string, AccountConnectionSnapshot>()
const clients: QueryClient[] = []
const roots: { root: Root; container: HTMLDivElement; controller: ReturnType<typeof createAccountSetupController> }[] = []

const credentialSetup: CredentialSetupPort = {
  describe: async () => ({ configured: false, writable: true }),
  set: vi.fn(async () => {
    throw new Error('Setup must stage the key, never write the saved credential directly')
  }),
}
const folderPicker: Parameters<typeof AccountSetupOverlay>[0]['folderPicker'] = {
  directoryPicker: {
    pick: async () => null,
    list: async () => {
      throw new Error('No OS folder reads in view tests')
    },
    createDirectory: async () => {
      throw new Error('No OS folder writes in view tests')
    },
  },
  registerWorkspace: async () => {
    throw new Error('No workspace writes in view tests')
  },
}
const currentOperation = (operationId: string): AccountConnectionSnapshot => {
  const value = operations.get(operationId)
  if (value === undefined) throw new Error('Unknown synthetic operation')
  return value
}
const flush = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
const button = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label)
  if (found === undefined) throw new Error(`No button named ${label}`)
  return found
}
const click = async (label: string): Promise<void> => {
  await act(async () => {
    button(label).click()
  })
  await flush()
}
const enter = async (selector: string, value: string): Promise<void> => {
  const input = document.querySelector<HTMLInputElement>(selector)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (input === null || setter === undefined) throw new Error('Missing native synthetic input')
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const enterKey = (value: string): Promise<void> => enter('#ai-account-api-key-value', value)
const press = async (element: Element, key: string): Promise<void> => {
  await act(async () => {
    const unhandled = element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    // jsdom has no keyboard default action; the browser submits the enclosing form on Enter.
    if (key === 'Enter' && unhandled) element.closest('form')?.requestSubmit()
  })
  await flush()
}
const field = (label: string): HTMLInputElement => {
  const element = [...document.querySelectorAll('label')].find(item => item.textContent === label)
  const input = element?.htmlFor === undefined ? document.querySelector(`input[aria-label="${label}"]`) : document.getElementById(element.htmlFor)
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input labelled ${label}`)
  return input
}
const enterField = (label: string, value: string): Promise<void> => {
  const input = field(label)
  return enter(input.id === '' ? `input[aria-label="${label}"]` : `[id="${input.id}"]`, value)
}
const expand = async (label: string): Promise<HTMLDetailsElement> => {
  const summary = [...document.querySelectorAll('summary')].find(item => item.textContent === label)
  if (!(summary?.parentElement instanceof HTMLDetailsElement)) throw new Error(`No details named ${label}`)
  const details = summary.parentElement
  if (!details.open) {
    await act(async () => {
      summary.click()
    })
    await flush()
  }
  return details
}
const mount = async (
  options: Parameters<ReturnType<typeof createAccountSetupController>['open']>[0] = {},
  initialFile = savedFile,
  ports: Pick<Parameters<typeof AccountSetupOverlay>[0], 'credentialSetup'> = { credentialSetup },
) => {
  let serial = 0
  const controller = createAccountSetupController(() => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`)
  controller.open(options)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(aiAccountsKeys.file, initialFile)
  clients.push(client)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ root, container, controller })
  await act(async () => {
    root.render(
      <PluginQueryProvider client={client}>
        <AccountSetupOverlay controller={controller} credentialSetup={ports.credentialSetup} folderPicker={folderPicker} />
      </PluginQueryProvider>,
    )
  })
  await flush()
  const setQueryData = vi.spyOn(client, 'setQueryData')
  const invalidateQueries = vi.spyOn(client, 'invalidateQueries')
  return { controller, client, setQueryData, invalidateQueries }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  operations.clear()
  for (const mock of [...Object.values(host), ...Object.values(login)]) mock.mockReset()
  host.read.mockResolvedValue(savedFile)
  login.status.mockResolvedValue({
    instanceId: 'pending-account',
    status: 'idle',
    message: 'Synthetic sign-in ready',
    errorCode: null,
    verificationUri: null,
    userCode: null,
    expiresAt: null,
  })
  host.copilotLoginStatus.mockResolvedValue({ instanceId: 'pending-account', status: 'idle', message: null, verificationUri: null, userCode: null })
  host.prepareAccountConnection.mockImplementation(async input => {
    const next = pending(input.requestId, input.kind)
    operations.set(input.requestId, next)
    return next
  })
  host.getAccountConnection.mockImplementation(async input => currentOperation(input.operationId))
  host.configureAccountConnection.mockImplementation(async input => {
    const before = currentOperation(input.operationId)
    if (before.account === null) throw new Error('Missing synthetic profile')
    const next: AccountConnectionSnapshot = {
      ...before,
      method: input.mode ?? before.method,
      account: {
        ...before.account,
        apiKeyEnv:
          input.apiKeyEnv ??
          (input.mode === 'key' ? 'SYNTHETIC_API_KEY' : input.mode === 'subscription' || input.mode === 'cli' ? '' : before.account.apiKeyEnv),
        homePath: input.homePath ?? before.account.homePath,
        shadowHomePath: input.shadowHomePath ?? before.account.shadowHomePath,
        apiBaseUrl: input.apiBaseUrl ?? before.account.apiBaseUrl,
        displayName: input.displayName?.trim() ?? before.account.displayName,
      },
    }
    operations.set(input.operationId, next)
    return next
  })
  host.completeAccountConnection.mockImplementation(async input => ({ ...currentOperation(input.operationId), status: 'complete' }))
  host.stageAccountConnectionKey.mockImplementation(async input => currentOperation(input.operationId))
  host.importAccountConnectionKey.mockImplementation(async input => currentOperation(input.operationId))
  host.discardAccountConnection.mockResolvedValue({ discarded: true })
  host.secretCatalogKeys.mockResolvedValue({ available: false, items: [] })
})

afterEach(async () => {
  await act(async () => {
    for (const view of roots.splice(0)) {
      view.controller.close()
      view.root.unmount()
      view.container.remove()
    }
    await vi.advanceTimersByTimeAsync(1)
  })
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('actual account setup view with operation-owned QueryClient data', () => {
  it('stages a trimmed new account name without publishing an account, then keeps it through verification', async () => {
    const onCreated = vi.fn()
    const view = await mount({ onCreated })
    await click('Claude account')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Connect Claude')
    expect(document.querySelector('input[aria-label="Account name"], #account-connection-name')).toBeNull()
    await click('Edit account name')
    expect(field('Account name').value).toBe('Synthetic Claude')
    await enterField('Account name', '  Work Claude  ')
    await click('Save name')
    const operationId = view.controller.getSnapshot()?.operationId
    expect(host.configureAccountConnection).toHaveBeenLastCalledWith(
      { operationId, displayName: 'Work Claude' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(document.querySelector('input[aria-label="Account name"]')).toBeNull()
    expect(document.body.textContent).toContain('Work Claude')
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', operationId])).toMatchObject({ account: { displayName: 'Work Claude' } })
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    await click('Verify subscription and add account')
    expect(currentOperation(operationId ?? '').account?.displayName).toBe('Work Claude')
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('pending-account')
  })

  it('keeps a rejected name editable and never publishes it as accepted', async () => {
    host.configureAccountConnection.mockRejectedValueOnce(new Error('Synthetic metadata-only failure'))
    const view = await mount()
    await click('Claude account')
    await click('Edit account name')
    await enterField('Account name', 'Rejected name')
    await click('Save name')
    expect(field('Account name').value).toBe('Rejected name')
    expect(document.body.textContent).toContain('Could not update the name')
    const operationId = view.controller.getSnapshot()?.operationId
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', operationId])).toMatchObject({ account: { displayName: 'Synthetic Claude' } })
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
  })

  it('does not claim a name was saved when an older Host ignores displayName', async () => {
    host.configureAccountConnection.mockImplementationOnce(async input => currentOperation(input.operationId))
    const view = await mount()
    await click('Claude account')
    await click('Edit account name')
    await enterField('Account name', 'Ignored by older Host')
    await click('Save name')
    expect(field('Account name').value).toBe('Ignored by older Host')
    expect(document.body.textContent).toContain('Could not update the name')
    const operationId = view.controller.getSnapshot()?.operationId
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', operationId])).toMatchObject({ account: { displayName: 'Synthetic Claude' } })
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
  })

  it('supports Enter to save and Escape to cancel only the name edit', async () => {
    const view = await mount()
    await click('Claude account')
    await click('Edit account name')
    await enterField('Account name', '  Keyboard Claude  ')
    await press(field('Account name'), 'Enter')
    expect(host.configureAccountConnection).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('Keyboard Claude')
    await click('Edit account name')
    await enterField('Account name', 'Discard this draft')
    await press(field('Account name'), 'Escape')
    expect(host.configureAccountConnection).toHaveBeenCalledTimes(1)
    expect(document.querySelector('input[aria-label="Account name"]')).toBeNull()
    expect(view.controller.getSnapshot()).not.toBeNull()
    expect(host.discardAccountConnection).not.toHaveBeenCalled()
    await click('Edit account name')
    expect(field('Account name').value).toBe('Keyboard Claude')
    await enterField('Account name', 'Discard by button')
    await click('Cancel name edit')
    expect(host.configureAccountConnection).toHaveBeenCalledTimes(1)
    expect(document.querySelector('input[aria-label="Account name"]')).toBeNull()
    expect(view.controller.getSnapshot()).not.toBeNull()
  })

  it('rejects blank or overlong names and discards a saved provisional name on setup cancellation', async () => {
    const view = await mount()
    await click('Claude account')
    await click('Edit account name')
    await enterField('Account name', '   ')
    await click('Save name')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('between 1 and 120 characters')
    await enterField('Account name', 'x'.repeat(121))
    await click('Save name')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('between 1 and 120 characters')
    expect(host.configureAccountConnection).not.toHaveBeenCalled()
    await enterField('Account name', 'x'.repeat(120))
    expect(button('Save name').disabled).toBe(false)
    await click('Save name')
    const operationId = view.controller.getSnapshot()?.operationId
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    await click('Cancel')
    expect(host.discardAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId, confirm: true })
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', operationId])).toBeUndefined()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
  })

  it.each([
    { provider: 'Claude', primary: ['Claude account', 'API key'] },
    { provider: 'Codex', primary: ['Browser sign-in', 'Existing login'] },
    { provider: 'Command Code', primary: ['API key', 'CLI login'] },
    { provider: 'Cursor', primary: ['Access token', 'CLI login'] },
    { provider: 'OpenCode Go', primary: [] },
  ])('keeps $provider common methods separate from collapsed existing credentials', async ({ provider, primary }) => {
    await mount()
    await click(`${provider} account`)
    const options = document.querySelector('[aria-label="Sign-in options"]')
    expect(options).not.toBeNull()
    expect([...(options?.querySelectorAll('[aria-label="Sign-in method"] button') ?? [])].map(item => item.textContent)).toEqual(primary)
    if (provider === 'Codex') {
      expect([...(options?.querySelectorAll('button') ?? [])].some(item => item.textContent === 'Use existing credential')).toBe(false)
      return
    }
    const reference = button('Use existing credential')
    expect(reference.closest('details')?.open).toBe(false)
    await expand('More options')
    await click('Use existing credential')
    expect(button('Use existing credential').getAttribute('aria-pressed')).toBe('true')
    expect(button('Use existing credential').closest('details')?.open).toBe(true)
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    expect(field('Existing credential reference')).toBeTruthy()
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
  })

  it('keeps key import and subscription safety details collapsed without removing their contents', async () => {
    await mount()
    await click('Claude account')
    const how = [...document.querySelectorAll('summary')].find(item => item.textContent === 'How this works')
    expect(how?.parentElement).toBeInstanceOf(HTMLDetailsElement)
    expect(how?.parentElement?.hasAttribute('open')).toBe(false)
    await expand('How this works')
    expect(document.body.textContent).toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(document.body.textContent).toContain('not remote token validation')
    await click('API key')
    const catalog = [...document.querySelectorAll('summary')].find(item => item.textContent === 'Import from Secret Catalog')
    expect(catalog?.parentElement?.hasAttribute('open')).toBe(false)
    await expand('Import from Secret Catalog')
    expect(button('Browse project/local secrets…')).toBeTruthy()
    expect(field('API key or setup token value').type).toBe('password')
  })

  it('returns OpenCode Go from an existing credential to manual key entry', async () => {
    await mount()
    await click('OpenCode Go account')
    await expand('More options')
    await click('Use existing credential')
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    await click('API key')
    expect(document.querySelector('#ai-account-api-key-value')).not.toBeNull()
    expect(host.configureAccountConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'key' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('keeps a staged account name across key and subscription method switches', async () => {
    const view = await mount()
    await click('Claude account')
    await click('Edit account name')
    await enterField('Account name', 'Methods Claude')
    await click('Save name')
    await click('API key')
    await enterKey('synthetic-key-remains-local')
    expect(document.body.textContent).toContain('Connect Claude')
    expect(document.body.textContent).toContain('Methods Claude')
    await click('Edit account name')
    expect(field('Account name').value).toBe('Methods Claude')
    await enterField('Account name', 'Keyed Claude')
    await click('Save name')
    expect(field('API key or setup token value').value).toBe('synthetic-key-remains-local')
    await click('Edit account name')
    await press(field('Account name'), 'Escape')
    await click('Claude account')
    expect(document.body.textContent).toContain('Keyed Claude')
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
  })

  it('keeps pending snapshots out of the global accounts cache and does not call onCreated', async () => {
    const onCreated = vi.fn()
    const view = await mount({ onCreated })
    await click('Claude account')
    const operationId = view.controller.getSnapshot()?.operationId
    expect(host.prepareAccountConnection).toHaveBeenCalledWith(
      { kind: 'claude', requestId: operationId },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', operationId])).toMatchObject({ status: 'pending' })
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(view.setQueryData).not.toHaveBeenCalledWith(aiAccountsKeys.file, expect.anything())
    expect(view.invalidateQueries).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: aiAccountsKeys.file }))
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('shows the Claude subscription path by default, without asking for a key', async () => {
    await mount()
    await click('Claude account')
    expect(document.body.textContent).toContain('No API key needed')
    expect(button('Verify subscription and add account')).toBeTruthy()
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    expect(host.configureAccountConnection).not.toHaveBeenCalled()
  })

  it('switches to explicit keyed mode and back through the real key dialog controls', async () => {
    const view = await mount()
    await click('Claude account')
    const operationId = view.controller.getSnapshot()?.operationId
    await click('API key')
    expect(host.configureAccountConnection).toHaveBeenCalledWith({ operationId, mode: 'key' }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(document.body.textContent).toContain('Connect Claude')
    expect(field('API key or setup token value').type).toBe('password')
    expect(document.querySelector('#ai-account-api-key-value')).not.toBeNull()
    expect(button('Verify and add account').disabled).toBe(true)
    await click('Claude account')
    expect(host.configureAccountConnection).toHaveBeenLastCalledWith(
      { operationId, mode: 'subscription' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(document.body.textContent).toContain('No API key needed')
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
  })

  it('applies an existing default Claude login or a custom home without publishing either before verification', async () => {
    const view = await mount()
    await click('Claude account')
    const operationId = view.controller.getSnapshot()?.operationId
    await expand('More options')
    await click('Use default Claude Code login')
    expect(host.configureAccountConnection).toHaveBeenLastCalledWith(
      { operationId, homePath: '~/.claude' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(field('CLAUDE_CONFIG_DIR').value).toBe('~/.claude')
    await enterField('CLAUDE_CONFIG_DIR', '/synthetic/existing-claude')
    await click('Apply CLI home settings')
    expect(host.configureAccountConnection).toHaveBeenLastCalledWith(
      { operationId, homePath: '/synthetic/existing-claude' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', operationId])).toMatchObject({
      method: 'subscription',
      account: { homePath: '/synthetic/existing-claude' },
    })
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    expect(host.stageAccountConnectionKey).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'commandcode', label: 'Command Code account', command: 'cmd login' },
    { kind: 'cursor', label: 'Cursor account', command: 'cursor-agent login' },
  ])('restores the $kind existing CLI login choice without key staging', async ({ label, command }) => {
    const onCreated = vi.fn()
    const view = await mount({ onCreated })
    await click(label)
    expect(document.querySelector('#ai-account-api-key-value')).not.toBeNull()
    await click('CLI login')
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    expect(document.querySelector('pre code')?.textContent).toBe(command)
    const operationId = view.controller.getSnapshot()?.operationId
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', operationId])).toMatchObject({ method: 'cli', account: { apiKeyEnv: '' } })
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    await click('Verify CLI login and add account')
    expect(host.completeAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(host.stageAccountConnectionKey).not.toHaveBeenCalled()
    expect(host.importAccountConnectionKey).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('pending-account')
  })

  it.each([
    { label: 'Command Code account', reference: 'COMMANDCODE_API_KEY' },
    { label: 'Cursor account', reference: 'CURSOR_WORK_API_KEY' },
    { label: 'OpenCode Go account', reference: 'OPENCODE_API_KEY' },
  ])('applies the existing $reference reference and verifies it without copying a key', async ({ label, reference }) => {
    const view = await mount()
    await click(label)
    await expand('More options')
    await click('Use existing credential')
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    await enterField('Existing credential reference', reference)
    await click('Apply credential reference')
    const operationId = view.controller.getSnapshot()?.operationId
    expect(host.configureAccountConnection).toHaveBeenLastCalledWith(
      { operationId, apiKeyEnv: reference },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(document.body.textContent).toContain(`Using ${reference}`)
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    await click('Verify and add account')
    expect(host.completeAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(host.stageAccountConnectionKey).not.toHaveBeenCalled()
    expect(host.importAccountConnectionKey).not.toHaveBeenCalled()
    expect(credentialSetup.set).not.toHaveBeenCalled()
  })

  it('preserves distinct custom Codex shared and auth overlay fields before committing a CLI connection', async () => {
    const view = await mount()
    await click('Codex account')
    expect(button('Continue with Codex')).toBeTruthy()
    await click('Existing login')
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    expect(document.querySelector('pre code')?.textContent).toContain('codex login')
    await enterField('Shared Codex home', '/synthetic/shared-codex')
    await enterField('Authentication overlay (CODEX_HOME)', '/synthetic/distinct-overlay')
    expect(host.configureAccountConnection).toHaveBeenCalledTimes(1)
    await click('Apply CLI home settings')
    const operationId = view.controller.getSnapshot()?.operationId
    expect(host.configureAccountConnection).toHaveBeenLastCalledWith(
      { operationId, homePath: '/synthetic/shared-codex', shadowHomePath: '/synthetic/distinct-overlay' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(field('Shared Codex home').value).toBe('/synthetic/shared-codex')
    expect(field('Authentication overlay (CODEX_HOME)').value).toBe('/synthetic/distinct-overlay')
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    await click('Verify CLI login and add account')
    expect(host.completeAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(login.begin).not.toHaveBeenCalled()
    expect(host.stageAccountConnectionKey).not.toHaveBeenCalled()
  })

  it('offers only GitHub device sign-in for a new Copilot account', async () => {
    await mount()
    await click('GitHub Copilot account')
    expect(button('Sign in with GitHub')).toBeTruthy()
    expect(document.querySelector('[aria-label="Sign-in method"]')).toBeNull()
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    expect(document.querySelector('input[aria-label="Account name"]')).toBeNull()
    expect(host.configureAccountConnection).not.toHaveBeenCalled()
    expect(host.beginCopilotLogin).not.toHaveBeenCalled()
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
  })

  it('keeps Claude subscription and home choices usable when the Host has no credential writer', async () => {
    const view = await mount({}, savedFile, { credentialSetup: undefined })
    await click('Claude account')
    expect(document.body.textContent).toContain('No API key needed')
    await expand('More options')
    await click('Use default Claude Code login')
    expect(field('CLAUDE_CONFIG_DIR').value).toBe('~/.claude')
    await click('API key')
    expect(document.body.textContent).toContain('Credential management is unavailable')
    expect(button('Claude account').disabled).toBe(false)
    await click('Claude account')
    expect(document.querySelector('#ai-account-api-key-value')).toBeNull()
    const operationId = view.controller.getSnapshot()?.operationId
    await click('Verify subscription and add account')
    expect(host.completeAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(host.stageAccountConnectionKey).not.toHaveBeenCalled()
  })

  it('keeps CLI and reference choices available from keyed setup without a credential writer', async () => {
    const view = await mount({}, savedFile, { credentialSetup: undefined })
    await click('Command Code account')
    expect(document.body.textContent).toContain('Credential management is unavailable')
    await click('CLI login')
    expect(document.querySelector('pre code')?.textContent).toBe('cmd login')
    await expand('More options')
    await click('Use existing credential')
    await enterField('Existing credential reference', 'COMMANDCODE_API_KEY')
    await click('Apply credential reference')
    const operationId = view.controller.getSnapshot()?.operationId
    await click('Verify and add account')
    expect(host.completeAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(host.stageAccountConnectionKey).not.toHaveBeenCalled()
    expect(credentialSetup.set).not.toHaveBeenCalled()
  })

  it('does not let an older in-flight poll undo the explicit Claude key-mode choice', async () => {
    const stalePoll = deferred<AccountConnectionSnapshot>()
    host.getAccountConnection.mockReturnValueOnce(stalePoll.promise)
    const view = await mount()
    await click('Claude account')
    const request = view.controller.getSnapshot()
    if (request === null) throw new Error('Missing synthetic request')
    expect(host.getAccountConnection).toHaveBeenCalled()
    const oldSubscription = currentOperation(request.operationId)
    await click('API key')
    expect(document.querySelector('#ai-account-api-key-value')).not.toBeNull()
    await act(async () => {
      stalePoll.resolve(oldSubscription)
    })
    await flush()
    expect(document.querySelector('#ai-account-api-key-value')).not.toBeNull()
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', request.operationId])).toMatchObject({ account: { apiKeyEnv: 'SYNTHETIC_API_KEY' } })
  })

  it('discards precisely the closed operation and removes only its provisional query', async () => {
    const view = await mount()
    await click('Claude account')
    const operationId = view.controller.getSnapshot()?.operationId
    await click('Cancel')
    expect(host.discardAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId, confirm: true })
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', operationId])).toBeUndefined()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(view.controller.getSnapshot()).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('replaces A by discarding A without discarding or closing the new B intent', async () => {
    const view = await mount()
    await click('Claude account')
    const first = view.controller.getSnapshot()
    await act(async () => {
      view.controller.open()
    })
    await flush()
    const second = view.controller.getSnapshot()
    expect(second?.operationId).not.toBe(first?.operationId)
    expect(first?.signal.aborted).toBe(true)
    expect(host.discardAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId: first?.operationId, confirm: true })
    await act(async () => {
      view.controller.close(first?.id)
    })
    expect(view.controller.getSnapshot()).toBe(second)
    expect(button('Claude account')).toBeTruthy()
  })

  it('tombstones a closed preparation and ignores a late pending response', async () => {
    const preparing = deferred<AccountConnectionSnapshot>()
    host.prepareAccountConnection.mockReturnValueOnce(preparing.promise)
    const onCreated = vi.fn()
    const view = await mount({ onCreated })
    await click('Claude account')
    const request = view.controller.getSnapshot()
    if (request === null) throw new Error('Missing synthetic request')
    await click('Cancel')
    expect(host.discardAccountConnection).toHaveBeenCalledWith({ operationId: request.operationId, confirm: true })
    await act(async () => {
      preparing.resolve(pending(request.operationId))
    })
    await flush()
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', request.operationId])).toBeUndefined()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(onCreated).not.toHaveBeenCalled()
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
  })

  it('calls onCreated only after successful complete, never during pending verification', async () => {
    const completing = deferred<AccountConnectionSnapshot>()
    host.completeAccountConnection.mockReturnValueOnce(completing.promise)
    const onCreated = vi.fn()
    const view = await mount({ onCreated })
    await click('Claude account')
    const request = view.controller.getSnapshot()
    if (request === null) throw new Error('Missing synthetic request')
    await click('Verify subscription and add account')
    expect(host.completeAccountConnection).toHaveBeenCalledWith({ operationId: request.operationId }, expect.objectContaining({ signal: request.signal }))
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    await act(async () => {
      completing.resolve({ ...currentOperation(request.operationId), status: 'complete' })
    })
    await flush()
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('pending-account')
    expect(view.controller.getSnapshot()).toBeNull()
    expect(view.invalidateQueries).toHaveBeenCalledWith({ queryKey: aiAccountsKeys.file, exact: true })
  })

  it('rejects a non-complete finish response without onCreated or global cache publication', async () => {
    host.completeAccountConnection.mockImplementationOnce(async input => currentOperation(input.operationId))
    const onCreated = vi.fn()
    const view = await mount({ onCreated })
    await click('Claude account')
    await click('Verify subscription and add account')
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.controller.getSnapshot()).not.toBeNull()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(document.body.textContent).toContain('Connection could not be verified')
  })

  it('stages a key without global account publication and waits for complete before onCreated', async () => {
    const staging = deferred<AccountConnectionSnapshot>()
    const completing = deferred<AccountConnectionSnapshot>()
    host.stageAccountConnectionKey.mockReturnValueOnce(staging.promise)
    host.completeAccountConnection.mockReturnValueOnce(completing.promise)
    const onCreated = vi.fn()
    const view = await mount({ onCreated })
    await click('Claude account')
    await click('API key')
    const request = view.controller.getSnapshot()
    if (request === null) throw new Error('Missing synthetic request')
    await enterKey('synthetic-input-only-key')
    await click('Verify and add account')
    expect(host.stageAccountConnectionKey).toHaveBeenCalledWith({ operationId: request.operationId, value: 'synthetic-input-only-key' })
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    await act(async () => {
      staging.resolve(currentOperation(request.operationId))
    })
    await flush()
    expect(host.completeAccountConnection).toHaveBeenCalledTimes(1)
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    await act(async () => {
      completing.resolve({ ...currentOperation(request.operationId), status: 'complete' })
    })
    await flush()
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('pending-account')
  })

  it('does not complete or publish a staged key that finishes after closing', async () => {
    const staging = deferred<AccountConnectionSnapshot>()
    host.stageAccountConnectionKey.mockReturnValueOnce(staging.promise)
    const onCreated = vi.fn()
    const view = await mount({ onCreated })
    await click('Claude account')
    await click('API key')
    const request = view.controller.getSnapshot()
    if (request === null) throw new Error('Missing synthetic request')
    await enterKey('synthetic-input-only-key')
    await click('Verify and add account')
    await click('Cancel')
    expect(host.discardAccountConnection).toHaveBeenCalledWith({ operationId: request.operationId, confirm: true })
    await act(async () => {
      staging.resolve(currentOperation(request.operationId))
    })
    await flush()
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(view.controller.getSnapshot()).toBeNull()
  })

  it('reconnects without a second account or a new-account callback and preserves the saved cache on close', async () => {
    const existing = { ...profile(), instanceId: 'saved-account', displayName: 'Saved Claude' }
    const existingFile = { ...savedFile, accounts: [existing] }
    host.read.mockResolvedValue(existingFile)
    host.prepareAccountConnection.mockImplementationOnce(async input => {
      const next = { ...pending(input.requestId), instanceId: existing.instanceId, account: existing }
      operations.set(input.requestId, next)
      return next
    })
    const onCreated = vi.fn()
    const view = await mount({ accountId: existing.instanceId, onCreated }, existingFile)
    const request = view.controller.getSnapshot()
    expect(host.prepareAccountConnection).toHaveBeenCalledWith(
      { kind: 'claude', requestId: request?.operationId, existingInstanceId: 'saved-account' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(document.querySelector('button[aria-label="Edit account name"]')).toBeNull()
    await click('Verify subscription and reconnect')
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(existingFile)
    expect(view.controller.getSnapshot()).toBeNull()
  })

  it.each(['contract', 'transport', 'unavailable'] as const)(
    'treats a %s completion error and unreadable poll as an unknown reconnect result, not rejected authentication',
    async kind => {
      const existing = { ...profile(), instanceId: 'saved-account', displayName: 'Saved Claude', signedIn: true }
      const existingFile = { ...savedFile, accounts: [existing] }
      host.read.mockResolvedValue(existingFile)
      host.prepareAccountConnection.mockImplementationOnce(async input => {
        const next = { ...pending(input.requestId), instanceId: existing.instanceId, account: existing }
        operations.set(input.requestId, next)
        return next
      })
      // Exercise the public adapter and real isApiError brand, including the actual
      // non-JSON output failure after a Host may already have committed sign-in.
      const apiFailure = async (failureKind: typeof kind, method: 'completeAccountConnection' | 'getAccountConnection') => {
        const api = createApiClient(
          failureKind === 'unavailable'
            ? undefined
            : {
                get: () => ({
                  rpc: {
                    call: async () => {
                      if (failureKind === 'transport') throw new Error('Synthetic connection lost after commit')
                      return { ok: true, value: { version: aiAccountsApi.version, output: { authSource: undefined } } }
                    },
                  },
                }),
              },
          aiAccountsApi,
        )
        const result = await api.safe[method]({ operationId: 'synthetic-operation' })
        if (result.ok) throw new Error('Expected the synthetic API boundary to reject')
        expect(isApiError(result.error)).toBe(true)
        expect(result.error.kind).toBe(failureKind)
        if (failureKind === 'contract')
          expect(result.error.message).toBe('API payload must contain only JSON values; undefined is permitted only for a void root.')
        return result.error
      }
      const finishError = await apiFailure(kind, 'completeAccountConnection')
      const pollError = await apiFailure('contract', 'getAccountConnection')
      host.completeAccountConnection.mockRejectedValueOnce(finishError)
      const onCreated = vi.fn()
      const view = await mount({ accountId: existing.instanceId, onCreated }, existingFile)
      const request = view.controller.getSnapshot()
      if (request === null) throw new Error('Missing synthetic reconnect request')
      await click('Verify subscription and reconnect')
      expect(document.body.textContent).toContain('The connection result could not be read. Sign-in may already be saved; close setup and check your accounts.')
      expect(document.body.textContent).not.toContain('could not be verified')
      expect([...document.querySelectorAll('button')].some(item => item.textContent === 'Verify subscription and reconnect')).toBe(false)
      expect(document.querySelector('[aria-label="Sign-in method"]')).toBeNull()
      // The terminal query failure must not replace uncertainty with a false
      // expired/rejected result or encourage a duplicate connection attempt.
      host.getAccountConnection.mockRejectedValue(pollError)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_001)
      })
      await flush()
      expect(view.client.getQueryState(['ai-accounts', 'account-connection', request.operationId])?.error).toBe(pollError)
      expect(document.body.textContent).toContain('Sign-in may already be saved')
      expect(document.body.textContent).toContain('check your accounts')
      expect(document.body.textContent).not.toContain('could not be verified')
      expect(document.body.textContent).not.toContain('verification failed')
      expect(document.body.textContent).not.toContain('expired')
      expect([...document.querySelectorAll('button')].some(item => item.textContent === 'Start again')).toBe(false)
      expect(host.completeAccountConnection).toHaveBeenCalledExactlyOnceWith(
        { operationId: request.operationId },
        expect.objectContaining({ signal: request.signal }),
      )
      expect(host.prepareAccountConnection).toHaveBeenCalledTimes(1)
      expect(host.configureAccountConnection).not.toHaveBeenCalled()
      expect(login.begin).not.toHaveBeenCalled()
      expect(host.stageAccountConnectionKey).not.toHaveBeenCalled()
      expect(host.importAccountConnectionKey).not.toHaveBeenCalled()
      expect(credentialSetup.set).not.toHaveBeenCalled()
      expect(onCreated).not.toHaveBeenCalled()
      expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(existingFile)
      expect(view.setQueryData).not.toHaveBeenCalledWith(aiAccountsKeys.file, expect.anything())
      expect(view.invalidateQueries).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: aiAccountsKeys.file }))
      expect(view.controller.getSnapshot()).toBe(request)
      expect(button('Close').disabled).toBe(false)
      await click('Close')
      expect(view.controller.getSnapshot()).toBeNull()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(existingFile)
      expect(host.prepareAccountConnection).toHaveBeenCalledTimes(1)
      expect(host.completeAccountConnection).toHaveBeenCalledTimes(1)
    },
  )

  it('requires explicit Codex replacement sign-in even when the existing credential is locally signed in, and preserves the saved account on cancellation', async () => {
    const existing = { ...profile('codex'), instanceId: 'saved-codex', displayName: 'Saved Codex', signedIn: true }
    const existingFile = { ...savedFile, accounts: [existing] }
    host.read.mockResolvedValue(existingFile)
    host.prepareAccountConnection.mockImplementationOnce(async input => {
      const next = { ...pending(input.requestId, 'codex'), instanceId: existing.instanceId, account: existing }
      operations.set(input.requestId, next)
      return next
    })
    const waiting = {
      instanceId: existing.instanceId,
      status: 'waiting',
      message: 'Synthetic approval pending',
      errorCode: null,
      verificationUri: null,
      userCode: null,
      expiresAt: Date.now() + 60_000,
    } satisfies Awaited<ReturnType<LoginClient['begin']>>
    login.begin.mockResolvedValue(waiting)
    login.cancel.mockResolvedValue({ ...waiting, status: 'cancelled' })
    const onCreated = vi.fn()
    const view = await mount({ accountId: existing.instanceId, onCreated }, existingFile)
    const request = view.controller.getSnapshot()
    if (request === null) throw new Error('Missing synthetic reconnect request')
    expect(button('Continue with Codex')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Verify and reconnect')
    expect(document.body.textContent).toContain('Cancellation preserves the existing login')
    expect(login.begin).not.toHaveBeenCalled()
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    await click('Continue with Codex')
    expect(login.begin).toHaveBeenCalledExactlyOnceWith({
      instanceId: existing.instanceId,
      operationId: request.operationId,
      replaceExisting: true,
    })
    expect(button('Cancel sign-in')).toBeTruthy()
    await click('Cancel sign-in')
    expect(login.cancel).toHaveBeenCalledExactlyOnceWith({ instanceId: existing.instanceId, operationId: request.operationId, confirm: true })
    expect(host.discardAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId: request.operationId, confirm: true })
    expect(host.completeAccountConnection).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(existingFile)
    expect(existing.signedIn).toBe(true)
    expect(view.controller.getSnapshot()).toBeNull()
  })

  it('keeps a healthy existing Copilot credential verification choice instead of forcing replacement sign-in', async () => {
    const existing = { ...profile('github-copilot'), instanceId: 'saved-copilot', displayName: 'Saved Copilot', signedIn: true }
    const existingFile = { ...savedFile, accounts: [existing] }
    host.read.mockResolvedValue(existingFile)
    host.prepareAccountConnection.mockImplementationOnce(async input => {
      const next = { ...pending(input.requestId, 'github-copilot'), instanceId: existing.instanceId, account: existing }
      operations.set(input.requestId, next)
      return next
    })
    const onCreated = vi.fn()
    const view = await mount({ accountId: existing.instanceId, onCreated }, existingFile)
    const operationId = view.controller.getSnapshot()?.operationId
    expect(button('Verify and reconnect')).toBeTruthy()
    expect(button('Sign in to another account')).toBeTruthy()
    expect(host.beginCopilotLogin).not.toHaveBeenCalled()
    expect(login.begin).not.toHaveBeenCalled()
    await click('Verify and reconnect')
    expect(host.completeAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(host.beginCopilotLogin).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(existingFile)
    expect(view.controller.getSnapshot()).toBeNull()
  })

  it('restarts a rejected reconnect after polling a discarded null-account operation with a fresh operation for the same saved account', async () => {
    const existing = { ...profile('commandcode'), instanceId: 'saved-commandcode', displayName: 'Saved Command Code', signedIn: true }
    const existingFile = { ...savedFile, accounts: [existing] }
    host.read.mockResolvedValue(existingFile)
    host.prepareAccountConnection.mockImplementation(async input => {
      const next = { ...pending(input.requestId, 'commandcode'), instanceId: existing.instanceId, account: existing }
      operations.set(input.requestId, next)
      return next
    })
    const completing = deferred<AccountConnectionSnapshot>()
    host.completeAccountConnection.mockImplementationOnce(async input => {
      operations.set(input.operationId, { ...currentOperation(input.operationId), status: 'discarded', account: null })
      return completing.promise
    })
    const onCreated = vi.fn()
    const view = await mount({ accountId: existing.instanceId, onCreated }, existingFile)
    const first = view.controller.getSnapshot()
    if (first === null) throw new Error('Missing synthetic reconnect request')
    await click('CLI login')
    await click('Verify CLI login and reconnect')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001)
    })
    await flush()
    expect(view.client.getQueryData(['ai-accounts', 'account-connection', first.operationId])).toMatchObject({ status: 'discarded', account: null })
    expect(currentOperation(first.operationId).expiresAt).toBeGreaterThan(Date.now())
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Reconnect account')
    expect(document.body.textContent).not.toContain('Add account')
    expect(document.body.textContent).not.toContain('expired')
    expect(button('Start again').disabled).toBe(true)
    await click('Start again')
    expect(view.controller.getSnapshot()).toBe(first)
    expect(host.prepareAccountConnection).toHaveBeenCalledTimes(1)
    await act(async () => {
      completing.reject(new Error('Synthetic verification rejected'))
    })
    await flush()
    expect(document.body.textContent).toContain('Your saved account is unchanged')
    expect(button('Start again').disabled).toBe(false)
    await click('Start again')
    const second = view.controller.getSnapshot()
    expect(second?.operationId).not.toBe(first.operationId)
    expect(second?.id).not.toBe(first.id)
    expect(second?.accountId).toBe(existing.instanceId)
    expect(second?.onCreated).toBe(onCreated)
    expect(first.signal.aborted).toBe(true)
    expect(host.prepareAccountConnection).toHaveBeenCalledTimes(2)
    expect(host.prepareAccountConnection).toHaveBeenLastCalledWith(
      { kind: 'commandcode', requestId: second?.operationId, existingInstanceId: existing.instanceId },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Reconnect Saved Command Code')
    expect(host.completeAccountConnection).toHaveBeenCalledTimes(1)
    expect(host.stageAccountConnectionKey).not.toHaveBeenCalled()
    expect(host.importAccountConnectionKey).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(existingFile)
  })

  it('ignores an old successful finish after replacement instead of calling back or closing B', async () => {
    const completing = deferred<AccountConnectionSnapshot>()
    host.completeAccountConnection.mockReturnValueOnce(completing.promise)
    const firstCreated = vi.fn()
    const secondCreated = vi.fn()
    const view = await mount({ onCreated: firstCreated })
    await click('Claude account')
    const first = view.controller.getSnapshot()
    if (first === null) throw new Error('Missing synthetic request')
    await click('Verify subscription and add account')
    await act(async () => {
      view.controller.open({ onCreated: secondCreated })
    })
    await flush()
    const second = view.controller.getSnapshot()
    await act(async () => {
      completing.resolve({ ...currentOperation(first.operationId), status: 'complete' })
    })
    await flush()
    expect(firstCreated).not.toHaveBeenCalled()
    expect(secondCreated).not.toHaveBeenCalled()
    expect(view.controller.getSnapshot()).toBe(second)
    expect(view.client.getQueryData(aiAccountsKeys.file)).toBe(savedFile)
    expect(host.discardAccountConnection).toHaveBeenCalledExactlyOnceWith({ operationId: first.operationId, confirm: true })
  })
})
