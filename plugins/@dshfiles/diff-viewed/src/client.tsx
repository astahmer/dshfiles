import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, defineSlot } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import type { ComponentProps } from 'react'
import { diffViewedLocale } from './locales.js'
import { useViewedMarksSync } from './use-viewed-marks.js'
import { createViewedMarks, type SyncedViewedMarks } from './viewed-marks.js'
import { ViewedToggle } from './viewed-toggle.js'

const marks = createViewedMarks({ storage: () => window.localStorage })

interface SyncedViewedToggleProps extends Omit<ComponentProps<typeof ViewedToggle>, 'marks'> {
  readonly marks: SyncedViewedMarks
}

const SyncedViewedToggle = (props: SyncedViewedToggleProps): JSX.Element => {
  useViewedMarksSync(props.marks)
  return <ViewedToggle {...props} />
}

const reviewFileAction = defineSlot('deliverables.review.file.actions', {
  id: 'dshfiles-diff-viewed',
  order: 10,
  locale: diffViewedLocale,
  inject: () => ({ marks }),
  component: (props: SyncedViewedToggleProps) => (
    <PluginQueryProvider>
      <SyncedViewedToggle {...props} />
    </PluginQueryProvider>
  ),
})

export default defineClient({
  name: '@dshfiles/diff-viewed',
  locales: [diffViewedLocale],
  slots: [reviewFileAction],
})
