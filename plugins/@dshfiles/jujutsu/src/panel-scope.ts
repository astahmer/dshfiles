import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { type Dispatch, type SetStateAction, useEffect, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'

/**
 * One Jujutsu panel, several contexts. The main view shows a single panel per key, so a tab that asks for another
 * repository tells this plugin which scope it is (main-tabs announces it before navigating); the side panel is one
 * scope per thread; the global dock is its own. Each scope keeps its repository, view and filters, so a thread's side
 * panel no longer follows whatever another thread picked.
 */
export const JUJUTSU_PANEL_ID = 'dshfiles-jujutsu'
export const DEFAULT_PANEL_SCOPE = 'default'
export const DOCK_PANEL_SCOPE = 'dock'

const MAIN_TAB_SCOPE_PREFIX = 'tab:'
const THREAD_SCOPE_PREFIX = 'thread:'
const PANEL_SCOPE_EVENT = 'dshfiles:panel-scope'
const PANEL_TAB_TITLE_EVENT = 'dshfiles:panel-tab-title'
const OPEN_PANEL_TAB_EVENT = 'dshfiles:open-panel-tab'

const scopeEventSchema = z.object({ panelId: z.string().min(1), scope: z.string().min(1).nullable() }).strict()

const scopeListeners = new Set<() => void>()
let activeScope = DEFAULT_PANEL_SCOPE

export const activeJujutsuScope = {
  get: (): string => activeScope,
  set: (next: string): void => {
    if (next === activeScope) return
    activeScope = next
    for (const listener of scopeListeners) listener()
  },
  subscribe: (listener: () => void): (() => void) => {
    scopeListeners.add(listener)
    return () => scopeListeners.delete(listener)
  },
}

export const useActiveJujutsuScope = (): string => useSyncExternalStore(activeJujutsuScope.subscribe, activeJujutsuScope.get, activeJujutsuScope.get)

const PANEL_SCOPE_STATE_KEY = 'dshfiles.jujutsu.panel-scopes.v1'
const PANEL_SCOPE_STATE_LIMIT = 40

const panelScopeStateSchema = z.record(
  z.string().max(200),
  z.object({
    path: z.string().max(4096).optional(),
    view: z.enum(['graph', 'source']).optional(),
  }),
)

export type PanelScopeState = z.infer<typeof panelScopeStateSchema>[string]
export type PanelScopeView = NonNullable<PanelScopeState['view']>

const NO_PANEL_SCOPES: Record<string, PanelScopeState> = {}
const storedPanelScopes = createStoredValue({ key: PANEL_SCOPE_STATE_KEY, schema: panelScopeStateSchema, fallback: NO_PANEL_SCOPES })

/** Panel state that belongs to one scope rather than the browser: filters, selection and expanded rows. */
const scopeMemory = new Map<string, Map<string, unknown>>()

/** The window events, persistence and defaults behind one scope per tab, thread and dock. */
export class PanelScopes {
  static thread(sessionId: string): string {
    return `${THREAD_SCOPE_PREFIX}${sessionId}`
  }

  static newMainTab(): string {
    return `${MAIN_TAB_SCOPE_PREFIX}${crypto.randomUUID()}`
  }

  /** A scope announcement aimed at another panel is not ours. */
  static read(event: Event): string | undefined {
    if (!(event instanceof CustomEvent)) return undefined
    const parsed = scopeEventSchema.safeParse(event.detail)
    if (!parsed.success || parsed.data.panelId !== JUJUTSU_PANEL_ID) return undefined
    return parsed.data.scope ?? DEFAULT_PANEL_SCOPE
  }

  static listen(): () => void {
    const onScope = (event: Event): void => {
      const scope = PanelScopes.read(event)
      if (scope !== undefined) activeJujutsuScope.set(scope)
    }
    window.addEventListener(PANEL_SCOPE_EVENT, onScope)
    return () => window.removeEventListener(PANEL_SCOPE_EVENT, onScope)
  }

  static persisted(scope: string): PanelScopeState {
    return storedPanelScopes.get()[scope] ?? {}
  }

  static remember(scope: string, patch: PanelScopeState): void {
    const all = storedPanelScopes.get()
    const current = all[scope] ?? {}
    const next = { ...all, [scope]: { ...current, ...patch } }
    const kept = Object.keys(next).slice(-PANEL_SCOPE_STATE_LIMIT)
    const capped: Record<string, PanelScopeState> = {}
    for (const key of kept) {
      const state = next[key]
      if (state !== undefined) capped[key] = state
    }
    storedPanelScopes.set(capped)
  }

  /** The repository a scope opens on right away (a request made before it mounted), kept for that scope. */
  static rememberPath(scope: string, path: string): void {
    PanelScopes.writeMemory(scope, 'path', path)
    PanelScopes.remember(scope, { path })
  }

  /**
   * The repository a scope opens on: what it last showed, the thread's own project, then — only for the panel's own
   * default and the dock, which shared one pick before scopes existed — the last repository opened anywhere.
   */
  static initialPath(input: { readonly scope: string; readonly defaultPath: string | null; readonly legacyPath: string }): string {
    const ownPick = input.scope.startsWith(THREAD_SCOPE_PREFIX) || input.scope.startsWith(MAIN_TAB_SCOPE_PREFIX)
    return PanelScopes.persisted(input.scope).path ?? input.defaultPath ?? (ownPick ? '' : input.legacyPath)
  }

  /** "Jujutsu · dshfiles" names the repository a scoped tab shows; the bare name is the panel default. */
  static title(root: string | null | undefined): string {
    const name = root === null || root === undefined ? '' : (root.split('/').filter(Boolean).at(-1) ?? '')
    return name.length === 0 ? 'Jujutsu' : `Jujutsu · ${name}`
  }

  static publishTitle(scope: string, root: string | null | undefined): void {
    if (!scope.startsWith(MAIN_TAB_SCOPE_PREFIX)) return
    window.dispatchEvent(new CustomEvent(PANEL_TAB_TITLE_EVENT, { detail: { panelId: JUJUTSU_PANEL_ID, scope, title: PanelScopes.title(root) } }))
  }

  /** Ask main-tabs for another Jujutsu tab, seeded with the repository the current one shows. */
  static requestTab(input: { readonly scope: string; readonly path: string | null }): void {
    if (input.path !== null) PanelScopes.remember(input.scope, { path: input.path })
    window.dispatchEvent(
      new CustomEvent(OPEN_PANEL_TAB_EVENT, {
        detail: { panelId: JUJUTSU_PANEL_ID, scope: input.scope, title: PanelScopes.title(input.path) },
      }),
    )
  }

  static readMemory<Value>(scope: string, key: string): Value | undefined {
    // SAFETY: only `usePanelScopeState` writes here, always under the same scope and key with the type it was called for.
    return scopeMemory.get(scope)?.get(key) as Value | undefined
  }

  static writeMemory<Value>(scope: string, key: string, value: Value): void {
    const bucket = scopeMemory.get(scope) ?? new Map<string, unknown>()
    bucket.set(key, value)
    scopeMemory.set(scope, bucket)
  }

  /** The value a scope's panel state starts from: what this page already showed for it, else the caller's default. */
  static rememberedState<Value>(scope: string, key: string, initial: () => Value): Value {
    const remembered = PanelScopes.readMemory<Value>(scope, key)
    return remembered === undefined ? initial() : remembered
  }
}

/**
 * State kept for one scope. Its repository and view are persisted; the rest lives as long as the page does, so typing
 * a filter never writes storage on every keystroke.
 */
export const usePanelScopeState = <Value>(scope: string, key: string, initial: () => Value): [Value, Dispatch<SetStateAction<Value>>] => {
  const [value, setValue] = useState<Value>(() => PanelScopes.rememberedState(scope, key, initial))
  useEffect(() => {
    PanelScopes.writeMemory(scope, key, value)
  }, [scope, key, value])
  return [value, setValue]
}
