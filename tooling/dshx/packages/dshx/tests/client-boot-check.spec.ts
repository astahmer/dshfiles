import { describe, expect, it } from 'vitest'
import { access, chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkClientBoot } from '../src/project/client-boot-check.js'
import { clientEntryFailures, compositionFailures, parseBootText } from '../src/project/client-boot-check.js'
import { slotRenderFailures } from '../src/project/browser-boot.js'

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
    expect(parseBootText(text)).toEqual([
      { id: '@deepseek-ai/dsh-client-ui-conversation', state: 'failed' },
      { id: '@deepseek-ai/dsh-client-ui-chat', state: 'pending', detail: '(waiting for service: uiConversation)' },
      { id: '@deepseek-ai/dsh-client-ui-goal', state: 'pending', detail: '(waiting for service: uiConversation)' },
    ])
  })

  it('keeps an import failure detail attached to its entry', () => {
    const text = [
      '@dshfiles/queue-reorder: failed: import failed: client-modules: "@dshfiles/queue-reorder" not loaded because dependency "@deepseek-ai/dsh-client-connection" failed',
    ].join('\n')
    expect(parseBootText(text)).toEqual([
      {
        id: '@dshfiles/queue-reorder',
        state: 'failed',
        detail: 'import failed: client-modules: "@dshfiles/queue-reorder" not loaded because dependency "@deepseek-ai/dsh-client-connection" failed',
      },
    ])
  })

  it('returns nothing for a card that lists only the failed entries', () => {
    const text = [
      'Failed to load plugins',
      '@deepseek-ai/dsh-client-hmr',
      '@deepseek-ai/dsh-client-ui-conversation',
      'web boot: 2 entries did not activate',
    ].join('\n')
    expect(parseBootText(text)).toEqual([])
  })

  it('returns nothing for empty text', () => {
    expect(parseBootText('')).toEqual([])
  })

  it('ignores lines that are not entry states', () => {
    const text = ['Booting DSH', 'ready', 'some: thing'].join('\n')
    expect(parseBootText(text)).toEqual([])
  })
})

describe('pending Client entries', () => {
  it('allows only explicit service waits outside the expected plugin entry', () => {
    const entries = parseBootText(
      [
        '@dshfiles/demo: pending (waiting for service: uiConversation)',
        '@deepseek-ai/dsh-client-ui-chat: pending (waiting for service: uiConversation)',
        '@deepseek-ai/dsh-client-ui-models: pending',
        '@deepseek-ai/dsh-client-ui-settings: failed: apply threw',
      ].join('\n'),
    )
    expect(clientEntryFailures(entries, ['@dshfiles/demo'])).toEqual([
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
    expect(slotRenderFailures([])).toEqual([])
  })

  it('reports the Slot named by the boundary marker', () => {
    expect(slotRenderFailures(['sidebar'])).toEqual([{ slot: 'sidebar' }])
  })

  it('reports every failing Slot, not just the first', () => {
    expect(slotRenderFailures(['sidebar', 'conversation.input.overlay'])).toEqual([{ slot: 'sidebar' }, { slot: 'conversation.input.overlay' }])
  })

  it('ignores a marker with no Slot name', () => {
    expect(slotRenderFailures([null, 'sidebar', ''])).toEqual([{ slot: 'sidebar' }])
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
