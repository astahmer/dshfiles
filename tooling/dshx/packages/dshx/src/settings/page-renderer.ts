/**
 * A browser-local seat for one plugin that draws every package's Plugins-page settings richer than the built-in
 * staged form (forced by @dshfiles/settings-shell). Each DSHX Client bundles its own copy of the page code, so the
 * seat lives on `globalThis` under a versioned name, like the command palette's action registry; the page asks it
 * on every render and falls back to the built-in form while it is empty.
 */
import type { ReactNode } from 'react'

/** What a renderer draws: the package's served settings namespaces, on its own Plugins page. */
export interface SettingsPageRendererProps {
  readonly packageId: string
  readonly namespaces: readonly string[]
}

export type SettingsPageRenderer = (props: SettingsPageRendererProps) => ReactNode

interface RendererSeat {
  renderer: SettingsPageRenderer | undefined
  readonly listeners: Set<() => void>
}

declare global {
  // Shared by every DSHX Client bundle on the page; the version suffix changes with an incompatible seat.
  var __dshxSettingsPageRendererV1: RendererSeat | undefined
}

const seat = (): RendererSeat => {
  globalThis.__dshxSettingsPageRendererV1 ??= { renderer: undefined, listeners: new Set() }
  return globalThis.__dshxSettingsPageRendererV1
}

/** Draw every package's Plugins-page settings with `renderer` until the returned disposer runs. */
const provideSettingsPageRenderer = (renderer: SettingsPageRenderer): (() => void) => {
  const current = seat()
  current.renderer = renderer
  current.listeners.forEach(listener => listener())
  return () => {
    if (current.renderer !== renderer) return
    current.renderer = undefined
    current.listeners.forEach(listener => listener())
  }
}

const settingsPageRenderer = (): SettingsPageRenderer | undefined => seat().renderer

const subscribeSettingsPageRenderer = (listener: () => void): (() => void) => {
  const current = seat()
  current.listeners.add(listener)
  return () => {
    current.listeners.delete(listener)
  }
}

export class SettingsPageRendererModel {
  static readonly provide = provideSettingsPageRenderer
  static readonly current = settingsPageRenderer
  static readonly subscribe = subscribeSettingsPageRenderer
}
