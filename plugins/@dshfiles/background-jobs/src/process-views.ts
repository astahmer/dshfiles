/**
 * Observe › Processes (docs/ade-ux §6 "Processes in 3 boards"): one page for what runs on this host on behalf of
 * threads. background-jobs owns the page and its Jobs tab; other plugins add a tab through `ProcessViews` and, when
 * they can filter to one thread, the matching part of the thread panel's Jobs facet.
 *
 * Providers (`@dshfiles/worktree-memory` for RAM, `@dshfiles/preview` for dev servers) depend on background-jobs, never
 * the reverse (docs/plugin-boundaries.md): without them the page shows only Jobs. Published as the
 * `@dshfiles/background-jobs/process-views` dshx module; importing it loads none of the page.
 */
import { defineContract, defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

/** What the Processes page hands a tab. */
export interface ProcessPageViewProps {
  /** Threads that run at least one background job now, newest activity first: where dev servers can live. */
  readonly threadIds: readonly string[]
  /** A label for a thread id (its title when the thread list knows it). */
  readonly threadLabel: (sessionId: string) => string
  readonly openThread: (sessionId: string) => void
}

/** What the thread panel's Jobs facet hands a section: the thread on the stage. */
export interface ProcessThreadViewProps {
  readonly sessionId: string
}

export interface ProcessView {
  /** Stable tab value (`dev-servers`, `ram`). */
  readonly id: string
  /** Tab label, sentence case. "RAM" names process memory; "Memory" is agent knowledge (docs/ade-ux glossary). */
  readonly label: string
  /** Lower first, after Jobs; ties keep registration order. */
  readonly order?: number
  /** The tab's body inside the Processes page; bind it with `api.bind(...)`. */
  readonly Page: ComponentType<ProcessPageViewProps>
  /** This view for one thread, in the Jobs facet; omit when the view cannot filter to a thread. */
  readonly Thread?: ComponentType<ProcessThreadViewProps>
  /**
   * A small mark the Processes navigation glyph draws over its icon (RAM: a pressure dot and the detached total), so a
   * leak shows without opening the page. Return null while there is nothing to say.
   */
  readonly Badge?: ComponentType<object>
}

export const ProcessViews = defineRegistry<ProcessView>('@dshfiles/background-jobs.process-view')

/** The Jobs tab's value; providers use any other id. */
export const PROCESSES_JOBS_TAB = 'jobs'

export interface ProcessesNavigationService {
  /** Select the Processes page on a tab (`jobs` by default). */
  readonly open: (tab?: string) => void
}

export const ProcessesNavigation = defineContract<ProcessesNavigationService>('@dshfiles/background-jobs.processes-navigation', {
  owner: '@dshfiles/background-jobs',
})
