import type * as React from 'react'

/** One showcased component. The card renders `render()` and remounts it on Replay. */
export interface GalleryDemo {
  readonly id: string
  readonly title: string
  /** One sentence: what it is and where it fits in DSH. */
  readonly description: string
  /** The import a plugin writes to use it, e.g. `@dshfiles/plugin-ui/components/motion/agent-queue`. */
  readonly source: string
  /** Span both grid columns (waterfalls, timelines). */
  readonly wide?: boolean
  /** Hide the Replay control for static components. */
  readonly static?: boolean
  readonly render: () => React.ReactNode
}

export interface GalleryCategory {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly demos: readonly GalleryDemo[]
}
