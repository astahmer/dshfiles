import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import {
  ackInputSchema,
  attachInputSchema,
  createInputSchema,
  dismissInputSchema,
  idInputSchema,
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
  unassignedSchema,
} from './schema.js'

export const storeErrorSchema = z.enum(['missing', 'revision', 'limit', 'status'])

export const annotationResultSchema = z.union([
  z.object({ ok: z.literal(true), annotation: annotationSchema }).strict(),
  z.object({ ok: z.literal(false), error: storeErrorSchema }).strict(),
])

export const annotationsResultSchema = z.union([
  z.object({ ok: z.literal(true), annotations: z.array(annotationSchema).max(50) }).strict(),
  z.object({ ok: z.literal(false), error: storeErrorSchema }).strict(),
])

export const createdOutputSchema = z.object({ annotations: z.array(annotationSchema).max(8) }).strict()
export const intakeResultSchema = z.object({ items: z.array(unassignedSchema).max(100) }).strict()
export const tokenOutputSchema = z.object({ token: z.string().min(20).max(200), createdAt: z.number().int().nonnegative() }).strict()

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
      input: z.object({}).strict(),
      output: setupOutputSchema,
      description: 'Where the browser extension lives and which endpoints it talks to. Client setup, never an Agent step.',
    }),
    chromeStatus: method({
      input: z.object({}).strict(),
      output: chromeStatusOutputSchema,
      description: 'Whether the no-extension picker browser is reachable, its executable and its pages. Client setup, never an Agent step.',
    }),
    chromeLaunch: method({
      input: z.object({}).strict(),
      output: chromeStatusOutputSchema,
      description: 'Start the DSH-owned Chrome profile with a loopback debugging port, then report its pages.',
    }),
    chromeStop: method({
      input: z.object({}).strict(),
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
      input: z.object({}).strict(),
      output: tokenOutputSchema,
      description: 'Read the browser-extension ingest token. Not agent-actionable: the device setup is a human step.',
    }),
  },
})

function attachmentsResultSchema() {
  return z.union([
    z.object({ ok: z.literal(true), annotations: z.array(annotationSchema).max(50) }).strict(),
    z.object({ ok: z.literal(false), error: storeErrorSchema }).strict(),
  ])
}

export type AnnotationsApi = typeof annotationsApi
export const annotationsApiIdInput = idInputSchema
export const intakeResult = intakeResultSchema
