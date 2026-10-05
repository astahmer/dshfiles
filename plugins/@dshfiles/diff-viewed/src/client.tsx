import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, defineSlot } from '@dshfiles/dshx/client'
import { diffViewedLocale } from './locales.js'
import { createViewedMarks } from './viewed-marks.js'
import { ViewedToggle } from './viewed-toggle.js'

const marks = createViewedMarks({ storage: window.localStorage })

const reviewFileAction = defineSlot('deliverables.review.file.actions', {
  id: 'dshfiles-diff-viewed',
  order: 10,
  locale: diffViewedLocale,
  inject: () => ({ marks }),
  component: ViewedToggle,
})

export default defineClient({
  name: '@dshfiles/diff-viewed',
  locales: [diffViewedLocale],
  slots: [reviewFileAction],
})
