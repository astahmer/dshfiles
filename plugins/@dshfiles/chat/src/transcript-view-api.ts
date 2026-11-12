import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import {
  OFFERED_TRANSCRIPT_VIEW_MODES,
  TRANSCRIPT_VIEW_MODE_DESCRIPTIONS,
  TRANSCRIPT_VIEW_MODE_NAMES,
  TRANSCRIPT_VIEW_MODES,
  type TranscriptViewMode,
} from './transcript-view-modes.ts'

const savedView = Schema.Struct({ saved: Schema.NullOr(Schema.Literals(TRANSCRIPT_VIEW_MODES)) })

/** One line for the Agent: the saved mode and what it shows, or that the device default applies. */
export const describeTranscriptView = (saved: TranscriptViewMode | null): string =>
  saved === null
    ? 'No view mode saved: Chat uses the device default (Summary on a touch phone, Normal elsewhere).'
    : `Chat view mode: ${TRANSCRIPT_VIEW_MODE_NAMES[saved]} (${saved}) — ${TRANSCRIPT_VIEW_MODE_DESCRIPTIONS[saved]}.`

const offered = OFFERED_TRANSCRIPT_VIEW_MODES.map(mode => `${mode} (${TRANSCRIPT_VIEW_MODE_NAMES[mode]}: ${TRANSCRIPT_VIEW_MODE_DESCRIPTIONS[mode]})`).join(
  '; ',
)

/**
 * The Chat view mode the user picks in Settings › General › View mode (visual refresh T2.5), as agent tools: the same
 * `dshfiles-chat` settings field the Settings row writes.
 */
export const transcriptViewApi = defineApi({
  id: 'chat-view',
  owner: '@dshfiles/chat',
  version: 1,
  methods: {
    get: method({
      input: Schema.Void,
      output: savedView,
      description: `Read the Chat view mode the user saved: ${offered}. null means the device default applies. Read-only.`,
      tool: { name: 'transcript_view_get', readOnly: true, render: output => describeTranscriptView(output.saved) },
    }),
    set: method({
      input: Schema.Struct({ mode: Schema.Literals([...OFFERED_TRANSCRIPT_VIEW_MODES, 'device-default']) }),
      output: savedView,
      description:
        'Set the Chat view mode: compact (Summary), detailed (Normal) or verbose (Verbose); device-default clears the saved choice so the device default applies again. It changes how every thread shows tool work, so call it only when the user asked for that view.',
      tool: { name: 'transcript_view_set', render: output => describeTranscriptView(output.saved) },
    }),
  },
})
