import { defineHost } from '@dshfiles/dshx/host'
import { turnSummarySettings } from './settings.js'
import { installTurnMarksProjection } from './turn-marks-projection.js'

export default defineHost({
  name: '@dshfiles/turn-summary',
  settings: [turnSummarySettings],
  // The whole-log facts behind Chat's turn map and "Since you left" recap (`@dshfiles/chat/turn-marks`).
  setup: ctx => {
    installTurnMarksProjection(ctx)
  },
})
