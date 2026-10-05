import {
  defineSessionFormatMigration,
  isSessionFormatJsonObject,
  SessionFormatError,
} from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

/** V4-to-V5 keeps every event and inherited cut unchanged. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5',
  fromVersion: 4,
  toVersion: 5,
  migrateHeader(header) {
    assertReleasedV4Header(header)
    return { ...header, version: 5 }
  },
  createStage(input) {
    let inheritedMarker: number | undefined
    return {
      ...(input.sourceInheritedEventCount === undefined
        ? {}
        : { headerInheritedEventCount: input.sourceInheritedEventCount }),
      transformEvent(event, context) {
        if (event.type === 'session/end-seed'
          && isSessionFormatJsonObject(event.data)
          && event.data['inherited'] === true) {
          inheritedMarker = event.seq
        }
        context.emitEvent(event)
      },
      transformRun(run, context) {
        context.emitRun(run)
      },
      finish() {
        if (input.sourceInheritedEventCount !== undefined) return input.sourceInheritedEventCount
        if (!input.sourceHeader.isSeeded) return 0
        if (inheritedMarker === undefined) {
          throw new SessionFormatError('seeded format v4 Session lacks an inherited marker')
        }
        return inheritedMarker
      },
    }
  },
  validateTargetHeader: assertReleasedV5Header,
})
