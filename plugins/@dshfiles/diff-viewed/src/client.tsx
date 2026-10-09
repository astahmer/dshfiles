import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, defineSlot } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import type { ComponentProps } from 'react'
import { diffViewedLocale } from './locales.js'
import { createViewedMarks } from './viewed-marks.js'
import { ViewedToggle } from './viewed-toggle.js'
import './client.css'

const marks = createViewedMarks({ storage: () => window.localStorage })

const reviewFileAction = defineSlot('deliverables.review.file.actions', {
  id: 'dshfiles-diff-viewed',
  order: 10,
  locale: diffViewedLocale,
  inject: () => ({ marks }),
  component: (props: ComponentProps<typeof ViewedToggle>) => (
    <PluginQueryProvider>
      <ViewedToggle {...props} />
    </PluginQueryProvider>
  ),
})

export default defineClient({
  name: '@dshfiles/diff-viewed',
  locales: [diffViewedLocale],
  slots: [reviewFileAction],
})
