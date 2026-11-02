import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import {
  ackInputSchema,
  attachInputSchema,
  createInputSchema,
  dismissInputSchema,
  intakeInputSchema,
  intakeOutputSchema,
  listInputSchema,
  replyInputSchema,
  resolveInputSchema,
  shownOutputSchema,
  chromePickInputSchema,
  chromePickOutputSchema,
  chromeStatusOutputSchema,
  pairInputSchema,
  setupOutputSchema,
  pairOutputSchema,
  previewInputSchema,
  previewOutputSchema,
  sourceInputSchema,
  sourceOutputSchema,
  staleInputSchema,
  annotationSchema,
} from './schema.js'

const storeErrorSchema = Schema.Literals(['missing', 'revision', 'limit', 'status'])

const annotationResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), annotation: annotationSchema }),
  Schema.Struct({ ok: Schema.Literal(false), error: storeErrorSchema }),
])

const annotationsResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), annotations: Schema.Array(annotationSchema).check(Schema.isMaxLength(50)) }),
  Schema.Struct({ ok: Schema.Literal(false), error: storeErrorSchema }),
])

const createdOutputSchema = Schema.Struct({ annotations: Schema.Array(annotationSchema).check(Schema.isMaxLength(8)) })
const tokenOutputSchema = Schema.Struct({
  token: Schema.String.check(Schema.isMinLength(20), Schema.isMaxLength(200)),
  createdAt: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
const emptyInputSchema = Schema.Struct({})

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const annotationsApi = defineApi({
  id: 'annotations',
  version: 1,
  owner: '@dshfiles/annotations',
  methods: {
    list: method({
      input: listInputSchema,
      output: shownOutputSchema,
      description:
        "List element annotations the user wrote about this Session's DSH UI, with per-status counts. Read-only; it never resolves or acknowledges anything.",
      tool: { name: 'annotations_list', readOnly: true, render: compactJson },
    }),
    create: method({
      input: createInputSchema,
      output: createdOutputSchema,
      description: 'Store element annotations picked in the client. Presentation feed, not agent-actionable.',
    }),
    ack: method({
      input: ackInputSchema,
      output: annotationsResultSchema,
      description: 'Mark annotations as seen. Call after reading them so the user knows the feedback was received; it does not resolve them.',
      tool: { name: 'annotations_ack', readOnly: false, render: compactJson },
    }),
    resolve: method({
      input: resolveInputSchema,
      output: annotationResultSchema,
      description:
        'Resolve one annotation after addressing it, binding the exact revision that was read. Call only when the user asked to close the feedback loop; a changed revision is refused.',
      tool: { name: 'annotations_resolve', readOnly: false, render: compactJson },
    }),
    dismiss: method({
      input: dismissInputSchema,
      output: annotationResultSchema,
      description: 'Dismiss one annotation the user decided not to address. Requires their reason; call only when the user asked to drop that feedback.',
      tool: { name: 'annotations_dismiss', readOnly: false, render: compactJson },
    }),
    reply: method({
      input: replyInputSchema,
      output: annotationResultSchema,
      description: 'Add a message to an annotation thread, for a clarifying question or an update. Call only when the user asked for that reply.',
      tool: { name: 'annotations_reply', readOnly: false, render: compactJson },
    }),
    stale: method({
      input: staleInputSchema,
      output: annotationResultSchema,
      description: 'Report that the annotated element no longer matches. Client feed; never resolves silently.',
    }),
    setup: method({
      input: emptyInputSchema,
      output: setupOutputSchema,
      description: 'Where the browser extension lives and which endpoints it talks to. Client setup, never an Agent step.',
    }),
    chromeStatus: method({
      input: emptyInputSchema,
      output: chromeStatusOutputSchema,
      description: 'Whether the no-extension picker browser is reachable, its executable and its pages. Client setup, never an Agent step.',
    }),
    chromeLaunch: method({
      input: emptyInputSchema,
      output: chromeStatusOutputSchema,
      description: 'Start the DSH-owned Chrome profile with a loopback debugging port, then report its pages.',
    }),
    chromeStop: method({
      input: emptyInputSchema,
      output: chromeStatusOutputSchema,
      description: 'Stop the picker browser this Host started. Nothing else on the machine is touched.',
    }),
    chromePick: method({
      input: chromePickInputSchema,
      output: chromePickOutputSchema,
      description: 'Arm the picker on one page and wait for the user to click an element or cancel. Resolves only on that interaction.',
    }),
    pair: method({
      input: pairInputSchema,
      output: pairOutputSchema,
      description:
        'Arm or read the extension pairing window. Arming lets the installed extension pull its token once; it never reveals the token to the Agent.',
    }),
    preview: method({
      input: previewInputSchema,
      output: previewOutputSchema,
      description: 'Read one local .html file for the annotated preview dialog. Bounded to the workspace and 2 MB; it returns no other file type.',
    }),
    source: method({
      input: sourceInputSchema,
      output: sourceOutputSchema,
      description:
        'Resolve CSS class names, selectors, or exact visible text to a source file and line in an owned plugin bundle. Read-only; returns no match rather than guessing.',
      tool: { name: 'annotations_source', readOnly: true, render: compactJson },
    }),
    intake: method({
      input: intakeInputSchema,
      output: intakeOutputSchema,
      description:
        'List annotations sent from the browser extension that the user has not attached to a Session yet. Read-only; it never attaches them by itself.',
      tool: { name: 'annotations_intake', readOnly: true, render: compactJson },
    }),
    attach: method({
      input: attachInputSchema,
      output: attachmentsResultSchema(),
      description: 'Attach unassigned extension annotations to the Session the user chose. Never guesses a Session.',
    }),
    token: method({
      input: emptyInputSchema,
      output: tokenOutputSchema,
      description: 'Read the browser-extension ingest token. Not agent-actionable: the device setup is a human step.',
    }),
  },
})

function attachmentsResultSchema() {
  return Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), annotations: Schema.Array(annotationSchema).check(Schema.isMaxLength(50)) }),
    Schema.Struct({ ok: Schema.Literal(false), error: storeErrorSchema }),
  ])
}

export type AnnotationsApi = typeof annotationsApi
