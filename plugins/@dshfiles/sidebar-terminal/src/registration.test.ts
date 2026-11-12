import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, it } from 'vitest'
import { registerTerminalExcerptTarget } from './native/client/excerpt-targets.ts'
import type { TerminalBodyInjected, TerminalInjected } from './native/client/face.ts'
import type { TerminalGuideInjected } from './native/client/TerminalGuide.tsx'
import type { TerminalExcerpt } from './native/client/excerpt.ts'
import { apply } from './native/client/index.ts'

type Release = () => void

interface RegisteredTab {
  readonly id: string
  readonly kind: string
  readonly multiple: boolean
  readonly priority: string
  readonly title: () => string
  readonly guide: readonly { readonly id: string }[]
}

type Resolution = { readonly status: 'handled'; readonly run: () => void } | { readonly status: 'blocked'; readonly reason: string }

interface RegisteredShortcut {
  readonly id: string
  readonly label: () => string
  readonly regions: readonly string[]
  readonly resolve: (context: { readonly region: string; readonly modal: null; readonly target: Element | null }) => Resolution
}

interface SlotDefinition {
  readonly name: string
  readonly key?: string
  readonly inject?: (sessionId: SessionId) => Injected
}

type Injected = TerminalBodyInjected | TerminalGuideInjected | TerminalInjected

const isBodyInjected = (value: Injected): value is TerminalBodyInjected =>
  'addExcerpt' in value && typeof value.addExcerpt === 'function' && 'registerExcerptTarget' in value

const createHarness = () => {
  const disposers: Release[] = []
  const tabs: RegisteredTab[] = []
  const shortcuts: RegisteredShortcut[] = []
  const closeHandlers = new Set<string>()
  const slots: SlotDefinition[] = []
  const locales: string[] = []
  let openTabListeners = 0
  let openTabReleases = 0
  const collect = (callback: () => Release | void): void => {
    const release = callback()
    if (typeof release === 'function') disposers.push(release)
  }
  const ctx = {
    effect: (callback: () => Release | void) => {
      collect(callback)
      return () => {}
    },
    locale: {
      bind: () => (key: string) => key,
      register: (namespace: string) => {
        locales.push(namespace)
        return () => {}
      },
    },
    shortcuts: {
      register: (command: RegisteredShortcut) => {
        shortcuts.push(command)
        return () => {}
      },
      catalog: { get: () => [], subscribe: () => () => {} },
    },
    sidebarRight: {
      openTabs: {
        getSnapshot: () => [{ kind: 'terminal', id: 'tab-1' }],
        subscribe: () => {
          openTabListeners += 1
          return () => {
            openTabReleases += 1
          }
        },
      },
      registerCloseHandler: (kind: string) => {
        closeHandlers.add(kind)
        return () => {}
      },
      commandTarget: () => undefined,
      openTabFromTarget: () => {},
      tabDomain: { occurrence: () => ({ navigation: { getSnapshot: () => ({ params: undefined, address: 'address' }) } }) },
    },
    sidebarRightTabs: {
      register: (tab: RegisteredTab) => {
        tabs.push(tab)
        return () => {}
      },
    },
    slots: {
      inject: (_name: string, callback: () => Release | void) => {
        collect(callback)
        return () => {}
      },
      register: (definition: SlotDefinition) => {
        slots.push(definition)
        return () => {}
      },
    },
    webTerminals: {
      retainTabs: () => {},
      view: () => ({ mount: () => () => {}, state: { get: () => undefined, subscribe: () => () => {} } }),
      close: () => {},
      launchShells: () => Promise.resolve([]),
      selectShell: () => {},
    },
    theme: { getTheme: () => ({ fontFamilies: { terminal: '' }, fontSizes: { terminal: 12 } }) },
    on: () => () => {},
  }
  return { ctx, disposers, tabs, shortcuts, closeHandlers, slots, locales, openTabs: () => ({ listeners: openTabListeners, releases: openTabReleases }) }
}

type Harness = ReturnType<typeof createHarness>

const applied = () => {
  const harness = createHarness()
  const attached: { readonly sessionId: string; readonly excerpt: TerminalExcerpt }[] = []
  const surface: unknown = harness.ctx
  // SAFETY: the harness implements exactly the Context members the terminal registration reads; no other member is called.
  const context = surface as Context
  apply(context, (sessionId, excerpt) => {
    attached.push({ sessionId, excerpt })
    return true
  })
  return { ...harness, attached }
}

const bodyInject = (harness: Harness, sessionId: SessionId): TerminalBodyInjected => {
  const body = harness.slots.find(slot => slot.name === 'sidebar.right.pane.tab')
  if (body?.inject === undefined) throw new Error('the terminal body slot was not registered')
  const injected = body.inject(sessionId)
  if (!isBodyInjected(injected)) throw new Error('the terminal body slot did not inject its excerpt commands')
  return injected
}

const excerpt = { text: 'first\nsecond', label: 'Terminal 3-4' }

it('registers the builtin terminal tab type with its close handler and guide', () => {
  const harness = applied()
  const tab = harness.tabs[0]
  expect(tab).toMatchObject({ kind: 'terminal', multiple: true, priority: 'builtin' })
  expect(tab?.title()).toBe('title')
  expect(tab?.guide.map(entry => entry.id)).toEqual(['new'])
  expect(harness.closeHandlers.has('terminal')).toBe(true)
  expect(harness.locales).toEqual(['sidebarTerminal'])
  expect(harness.shortcuts.map(shortcut => shortcut.id)).toEqual(['terminal.new', 'terminal.excerpt'])
  expect(harness.slots.map(slot => slot.name)).toEqual([
    'sidebar.right.tab.guide.entry',
    'sidebar.right.pane.tab',
    'sidebar.right.pane.tab.title',
    'conversation.session.header.actions',
  ])
})

it('binds each terminal body to the session that owns it', () => {
  const harness = applied()
  const first = bodyInject(harness, SessionId('session-first'))
  const second = bodyInject(harness, SessionId('session-second'))
  expect(first.addExcerpt(excerpt)).toBe(true)
  expect(second.addExcerpt({ text: 'only second', label: 'Terminal 8' })).toBe(true)
  expect(harness.attached).toEqual([
    { sessionId: 'session-first', excerpt },
    { sessionId: 'session-second', excerpt: { text: 'only second', label: 'Terminal 8' } },
  ])
})

it('blocks the excerpt shortcut until a terminal holds a selection', () => {
  const harness = applied()
  const shortcut = harness.shortcuts.find(command => command.id === 'terminal.excerpt')
  if (shortcut === undefined) throw new Error('the excerpt shortcut was not registered')
  expect(shortcut.regions).toEqual(['terminal'])
  expect(shortcut.resolve({ region: 'terminal', modal: null, target: document.body })).toEqual({ status: 'blocked', reason: 'excerptNoSelection' })

  let attached = 0
  const screen = document.createElement('div')
  const release = registerTerminalExcerptTarget({
    contains: node => node !== null && screen.contains(node),
    selected: () => true,
    attach: () => {
      attached += 1
    },
  })
  const resolution = shortcut.resolve({ region: 'terminal', modal: null, target: screen })
  if (resolution.status !== 'handled') throw new Error('the excerpt shortcut did not handle the selection')
  resolution.run()
  expect(attached).toBe(1)
  release()
  expect(shortcut.resolve({ region: 'terminal', modal: null, target: screen })).toEqual({ status: 'blocked', reason: 'excerptNoSelection' })
})

it('releases the sidebar listener and the window hold on dispose', () => {
  const harness = applied()
  expect(harness.openTabs()).toEqual({ listeners: 1, releases: 0 })
  for (const release of harness.disposers) release()
  expect(harness.openTabs()).toEqual({ listeners: 1, releases: 1 })
})
