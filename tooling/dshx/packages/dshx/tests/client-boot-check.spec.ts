import { describe, expect, it } from 'vitest'
import { access, chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkClientBoot, ClientBootCheckModel, compositionFailures } from '../src/project/client-boot-check.js'
import { BrowserBootModel, type BrowserBootEvidence, type BrowserBootOutcome } from '../src/project/browser-boot.js'

/**
 * The boot card is the only surface that records why a client entry did not
 * activate, so the parser is what turns a browser run into an actionable
 * diagnostic. These texts are copied from the card the Web UI actually renders.
 */
describe('client boot card parsing', () => {
  it('reads the entries the card lists after the summary line', () => {
    const text = [
      'Failed to load plugins',
      '@deepseek-ai/dsh-client-ui-conversation',
      'web boot: 8 entries did not activate',
      '@deepseek-ai/dsh-client-ui-conversation: failed',
      '@deepseek-ai/dsh-client-ui-chat: pending (waiting for service: uiConversation)',
      '@deepseek-ai/dsh-client-ui-goal: pending (waiting for service: uiConversation)',
    ].join('\n')
    expect(ClientBootCheckModel.parseBootText(text)).toEqual([
      { id: '@deepseek-ai/dsh-client-ui-conversation', state: 'failed' },
      { id: '@deepseek-ai/dsh-client-ui-chat', state: 'pending', detail: '(waiting for service: uiConversation)' },
      { id: '@deepseek-ai/dsh-client-ui-goal', state: 'pending', detail: '(waiting for service: uiConversation)' },
    ])
  })

  it('keeps an import failure detail attached to its entry', () => {
    const text = [
      '@dshfiles/queue-reorder: failed: import failed: client-modules: "@dshfiles/queue-reorder" not loaded because dependency "@deepseek-ai/dsh-client-connection" failed',
    ].join('\n')
    expect(ClientBootCheckModel.parseBootText(text)).toEqual([
      {
        id: '@dshfiles/queue-reorder',
        state: 'failed',
        detail: 'import failed: client-modules: "@dshfiles/queue-reorder" not loaded because dependency "@deepseek-ai/dsh-client-connection" failed',
      },
    ])
  })

  it('redacts tokenized local URLs from entry details', () => {
    const entries = ClientBootCheckModel.parseBootText('@dshfiles/demo: failed: opened http://127.0.0.1:3199/private-token')
    expect(entries).toEqual([{ id: '@dshfiles/demo', state: 'failed', detail: 'opened http://127.0.0.1:3199/[redacted]' }])
  })

  it('returns nothing for a card that lists only the failed entries', () => {
    const text = [
      'Failed to load plugins',
      '@deepseek-ai/dsh-client-hmr',
      '@deepseek-ai/dsh-client-ui-conversation',
      'web boot: 2 entries did not activate',
    ].join('\n')
    expect(ClientBootCheckModel.parseBootText(text)).toEqual([])
  })

  it('returns nothing for empty text', () => {
    expect(ClientBootCheckModel.parseBootText('')).toEqual([])
  })

  it('ignores lines that are not entry states', () => {
    const text = ['Booting DSH', 'ready', 'some: thing'].join('\n')
    expect(ClientBootCheckModel.parseBootText(text)).toEqual([])
  })
})

describe('pending Client entries', () => {
  it('allows only explicit service waits outside the expected plugin entry', () => {
    const entries = ClientBootCheckModel.parseBootText(
      [
        '@dshfiles/demo: pending (waiting for service: uiConversation)',
        '@deepseek-ai/dsh-client-ui-chat: pending (waiting for service: uiConversation)',
        '@deepseek-ai/dsh-client-ui-models: pending',
        '@deepseek-ai/dsh-client-ui-settings: failed: apply threw',
      ].join('\n'),
    )
    expect(ClientBootCheckModel.clientEntryFailures(entries, ['@dshfiles/demo'])).toEqual([
      { id: '@dshfiles/demo', state: 'pending', detail: '(waiting for service: uiConversation)' },
      { id: '@deepseek-ai/dsh-client-ui-models', state: 'pending' },
      { id: '@deepseek-ai/dsh-client-ui-settings', state: 'failed', detail: 'apply threw' },
    ])
  })
})

/**
 * A Slot that throws while rendering is invisible to the boot audit: its fiber
 * already reached active, so only the renderer's error boundary records it. That
 * is how a sidebar once rendered as <div data-slot-error="sidebar"> with a clean
 * audit and every other check green.
 */
describe('slot render failures', () => {
  it('reports nothing when every Slot rendered its entry', () => {
    expect(BrowserBootModel.slotRenderFailures([])).toEqual([])
  })

  it('reports the Slot named by the boundary marker', () => {
    expect(BrowserBootModel.slotRenderFailures(['sidebar'])).toEqual([{ slot: 'sidebar', source: 'boundary' }])
  })

  it('reports every failing Slot, not just the first', () => {
    expect(BrowserBootModel.slotRenderFailures(['sidebar', 'conversation.input.overlay'])).toEqual([
      { slot: 'sidebar', source: 'boundary' },
      { slot: 'conversation.input.overlay', source: 'boundary' },
    ])
  })

  it('ignores a marker with no Slot name', () => {
    expect(BrowserBootModel.slotRenderFailures([null, 'sidebar', ''])).toEqual([{ slot: 'sidebar', source: 'boundary' }])
  })
})

/**
 * The second shape of the same failure. A shadowing Slot kind retires the crashed
 * entry onto the cell's next survivor, so the boundary marker is gone by the time
 * a reader looks: only the renderer's console line still names the Slot. This is
 * how @dshfiles/thread-sidebar silently lost its sidebar to the native workspace
 * browser, with every marker-based check green.
 */
describe('slot crashes read from the console', () => {
  it('names the Slot from the entry crash line', () => {
    expect(
      BrowserBootModel.slotCrashesFromConsole(["slot entry crashed in 'sidebar.workspaces': Error: No QueryClient set, use QueryClientProvider to set one"]),
    ).toEqual([{ slot: 'sidebar.workspaces', source: 'crash' }])
  })

  it('names the Slot from a Factory occurrence crash line', () => {
    expect(BrowserBootModel.slotCrashesFromConsole(["slot factory occurrence crashed in 'sidebar': TypeError: x is not a function"])).toEqual([
      { slot: 'sidebar', source: 'crash' },
    ])
  })

  it('reads past the diagnostics prefix the E2E harness adds', () => {
    expect(BrowserBootModel.slotCrashesFromConsole(["console.error: slot entry crashed in 'conversation.chat.turnTail': Error: boom"])).toEqual([
      { slot: 'conversation.chat.turnTail', source: 'crash' },
    ])
  })

  it('ignores every other console line and reports each Slot once', () => {
    expect(
      BrowserBootModel.slotCrashesFromConsole([
        'Failed to load plugin @dshfiles/demo',
        "slot entry crashed in 'sidebar.workspaces': Error: boom",
        "slot entry crashed in 'sidebar.workspaces': Error: boom again",
      ]),
    ).toEqual([{ slot: 'sidebar.workspaces', source: 'crash' }])
  })
})

describe('offline composition gate', () => {
  it('names every expected bundle the dump-config document does not compose', () => {
    const dump = ['# == @deepseek-ai/dsh-base', '- id: dshfiles-shortcuts', '  name: "@dshfiles/shortcuts"', '# == @deepseek-ai/dsh-web-app'].join('\n')
    expect(compositionFailures(dump, ['@dshfiles/shortcuts'])).toEqual([])
    expect(compositionFailures(dump, ['@dshfiles/shortcuts', '@dshfiles/ai-accounts'])).toEqual(['@dshfiles/ai-accounts'])
    expect(compositionFailures('- name: "@dshfiles/plugin-tools"', ['@dshfiles/plugin'])).toEqual(['@dshfiles/plugin'])
  })

  it('reports a failed composition process and preserves caller-owned profiles', async () => {
    const profileRoot = await mkdtemp(join(tmpdir(), 'dshx-caller-profile-'))
    await writeFile(join(profileRoot, 'package.json'), '{}')
    try {
      const result = await checkClientBoot({
        projectRoot: process.cwd(),
        profile: 'fixture',
        port: 0,
        dshHome: profileRoot,
        profileRoot,
        expectedBundles: ['@test/plugin'],
        expectedClientEntries: ['@test/plugin'],
        executable: join(tmpdir(), 'missing-dshx-executable'),
      })
      expect(result.ok).toBe(false)
      expect(result.processError).toContain('dsh --dump-config could not start')
      await expect(stat(profileRoot)).resolves.toBeDefined()
    } finally {
      await rm(profileRoot, { recursive: true, force: true })
    }
  })

  it('does not launch a Host when the expected bundle is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshx-client-profile-fixture-'))
    const profileRoot = join(root, 'profiles', 'fixture')
    const marker = join(root, 'host-started')
    const executable = join(root, 'dsh-fixture')
    await mkdir(profileRoot, { recursive: true })
    await writeFile(join(profileRoot, 'package.json'), '{}')
    await writeFile(
      executable,
      `#!${process.execPath}\nif (process.argv.includes('--dump-config')) process.stdout.write('@deepseek-ai/dsh-base\\n'); else require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')\n`,
    )
    await chmod(executable, 0o755)
    try {
      const result = await checkClientBoot({
        projectRoot: process.cwd(),
        profile: 'fixture',
        port: 0,
        dshHome: root,
        profileRoot,
        expectedBundles: ['@test/plugin'],
        expectedClientEntries: ['@test/plugin'],
        executable,
      })
      const hostStarted = await access(marker).then(
        () => true,
        () => false,
      )
      expect(result.ok).toBe(false)
      expect(result.compositionFailures).toEqual(['@test/plugin'])
      expect(hostStarted).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

/**
 * The boot reader decides pass and fail from native DOM surfaces. A stubbed page
 * reproduces the states a real browser shows — including the blank page that a
 * naive "card absent means mounted" reader passes.
 */
describe('client boot outcome reader', () => {
  type NativeOutcome = Omit<BrowserBootOutcome, 'ok' | 'slotFailures'>

  interface StubPage {
    evaluate<Argument, Result>(pageFunction: (argument: Argument) => Result, argument?: Argument): Promise<Result>
  }

  const nativeOutcome = (evidence: BrowserBootEvidence, ready: boolean, text = ''): NativeOutcome => ({
    ready,
    missingClientEntries: [],
    failureCardVisible: evidence === 'failure-card',
    text,
    timedOut: !ready,
    ...(!ready && { readinessError: 'Native readiness was not established.' }),
    evidence,
  })

  const page = (outcome: NativeOutcome, slotErrors: string[] = []): StubPage => {
    let evaluation = 0
    return {
      evaluate: async <Argument, Result>(_pageFunction: (argument: Argument) => Result, _argument?: Argument): Promise<Result> => {
        evaluation += 1
        // SAFETY: the stub stands in for Playwright's Page; the reader's own return type describes this JSON payload.
        return (evaluation === 1 ? outcome : JSON.stringify(slotErrors)) as Result
      },
    }
  }

  const options = { timeoutMs: 400, expectedClientEntries: [] }

  it('passes when the native readiness signal and application outlet are ready', async () => {
    const outcome = await BrowserBootModel.readOutcome(page(nativeOutcome('app-outlet', true)), options)
    expect(outcome).toMatchObject({ ok: true, ready: true, evidence: 'app-outlet', text: '' })
  })

  it('keeps the boot-card handoff evidence while requiring native readiness', async () => {
    const outcome = await BrowserBootModel.readOutcome(page(nativeOutcome('boot-card-cleared', false)), options)
    expect(outcome).toMatchObject({ ok: true, ready: false, evidence: 'boot-card-cleared' })
  })

  it('reports a blank page as a failed outcome', async () => {
    const outcome = await BrowserBootModel.readOutcome(page(nativeOutcome('blank', false)), options)
    expect(outcome).toMatchObject({ ok: false, ready: false, evidence: 'blank', text: '' })
  })

  it('reports a stalled boot card with its text', async () => {
    const outcome = await BrowserBootModel.readOutcome(page(nativeOutcome('stalled', false, 'Loading plugins…')), options)
    expect(outcome).toMatchObject({ ok: false, ready: false, evidence: 'stalled', text: 'Loading plugins…' })
  })

  it('reports a failure card and the Slot error markers', async () => {
    const text = 'Failed to load plugins\n@dshfiles/demo: failed'
    const outcome = await BrowserBootModel.readOutcome(page(nativeOutcome('failure-card', false, text), ['settings']), options)
    expect(outcome).toMatchObject({
      ok: false,
      ready: false,
      evidence: 'failure-card',
      text,
      slotFailures: [{ slot: 'settings', source: 'boundary' }],
    })
  })

  it('reports a retired Slot entry the DOM no longer marks', async () => {
    const outcome = await BrowserBootModel.readOutcome(page(nativeOutcome('app-outlet', true)), {
      ...options,
      consoleMessages: ["slot entry crashed in 'sidebar.workspaces': Error: No QueryClient set, use QueryClientProvider to set one"],
    })

    // The page mounted, the audit is clean and no marker is left; only the crash line proves the takeover.
    expect(outcome).toMatchObject({ ready: true, evidence: 'app-outlet' })
    expect(outcome.slotFailures).toEqual([{ slot: 'sidebar.workspaces', source: 'crash' }])
  })

  it('keeps the mounted boundary when a Slot appears in both traces', async () => {
    const outcome = await BrowserBootModel.readOutcome(page(nativeOutcome('app-outlet', true), ['sidebar.workspaces']), {
      ...options,
      consoleMessages: ["slot entry crashed in 'sidebar.workspaces': Error: boom"],
    })

    expect(outcome.slotFailures).toEqual([{ slot: 'sidebar.workspaces', source: 'boundary' }])
  })
})

describe('host response probe', () => {
  const listenRandomPort = async (server: Server): Promise<{ readonly url: string; readonly close: () => Promise<void> }> => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('The fixture server did not bind a port.')
    return {
      url: `http://127.0.0.1:${String(address.port)}/`,
      close: () => new Promise<void>(resolve => server.close(() => resolve())),
    }
  }

  it('returns as soon as the Host answers rather than settling for a fixed window', async () => {
    const fixture = await listenRandomPort(createServer((_request, response) => response.end('ok')))
    try {
      const startedAt = Date.now()
      await ClientBootCheckModel.waitForHostResponse(fixture.url, 5_000)
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    } finally {
      await fixture.close()
    }
  })

  it('gives up at its deadline when the announced URL never answers', async () => {
    const fixture = await listenRandomPort(createServer(() => {}))
    await fixture.close()
    const startedAt = Date.now()
    await ClientBootCheckModel.waitForHostResponse(fixture.url, 300)
    const elapsed = Date.now() - startedAt
    expect(elapsed).toBeGreaterThanOrEqual(250)
    expect(elapsed).toBeLessThan(5_000)
  })
})
