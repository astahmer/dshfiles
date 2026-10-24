import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useSyncExternalStore, type ReactNode } from 'react'
import { z } from 'zod'
import { ReviewModel, type ReviewSource } from './review-model.js'
import { ReviewSurface } from './review-surface.js'

/** The plugin's identity in the tab system, and the key its body registers under. */
export const REVIEW_TAB_ID = '@dshfiles/pulls-review'
export const REVIEW_TAB_KIND = 'changes-review'
export const REVIEW_TAB_PATTERN = 'dsh-resource://changes-review/**'

const navigationSchema = z.object({ params: z.object({ index: z.number().int().nonnegative().optional() }).optional() }).passthrough()

export interface ReviewTabBodyOptions {
  readonly sessions: ISessions
  readonly onExpand?: (() => void) | undefined
}

/** The `changes-review` tab body: an all-files review of the turn the address names. */
export const createReviewTabBody =
  (options: ReviewTabBodyOptions) =>
  (props: PropsRuntime<'sidebar.right.pane.tab'>): ReactNode => {
    const { tab } = props.useTabInfo()
    const source: Extract<ReviewSource, { kind: 'turn' }> | undefined = ReviewModel.parseChangesReviewAddress(tab.contentId)
    const navigation = navigationSchema.safeParse(tab.navigation)
    const initialFileIndex = navigation.success ? navigation.data.params?.index : undefined
    const workspacePath = useSyncExternalStore(
      listener => options.sessions.list.subscribe(listener),
      () => options.sessions.list.getSnapshot().byId[props.sessionId]?.cwd,
      () => undefined,
    )
    if (source === undefined) {
      return <p className="dshx-root dshx:p-4 dshx:text-xs dshx:text-muted-foreground">This review address cannot be opened here.</p>
    }
    return (
      <PluginQueryProvider>
        <ReviewSurface
          turn={source}
          workspacePath={workspacePath}
          initialFileIndex={initialFileIndex}
          variant="tab"
          onExpand={options.onExpand}
          sessionId={String(props.sessionId)}
        />
      </PluginQueryProvider>
    )
  }
