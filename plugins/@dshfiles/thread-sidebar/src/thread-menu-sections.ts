/**
 * Sections other plugins add to the thread header's `⋯` menu (b:ysaj). Published as the
 * `@dshfiles/thread-sidebar/thread-menu-sections` dshx module, so a contributor imports this token and none of the
 * sidebar's runtime. The menu renders each section with the menu's own parts (item, submenu), so a contributor never
 * brings a second menu implementation into it; a section renders `null` when it has nothing for the thread.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType, ReactNode } from 'react'

/** The menu parts a section composes, owned by the sidebar's menu. */
export interface ThreadMenuParts {
  readonly Item: ComponentType<{ readonly onSelect?: (event: Event) => void; readonly disabled?: boolean; readonly children?: ReactNode }>
  readonly Sub: ComponentType<{ readonly children?: ReactNode }>
  readonly SubTrigger: ComponentType<{ readonly children?: ReactNode }>
  readonly SubContent: ComponentType<{ readonly 'aria-label'?: string; readonly children?: ReactNode }>
}

export interface ThreadMenuSectionProps extends ThreadMenuParts {
  readonly sessionId: string
}

/** One section of the header menu. Its id starts with the contributing package scope: `@scope/plugin/...`. */
export interface ThreadMenuSection {
  readonly id: string
  readonly order?: number
  /** Bound with `plugin.bind`, so it reads its own plugin's APIs inside the sidebar's menu. */
  readonly Component: ComponentType<ThreadMenuSectionProps>
}

export const ThreadMenuSections = defineRegistry<ThreadMenuSection>('@dshfiles/thread-sidebar.thread-menu-section')
