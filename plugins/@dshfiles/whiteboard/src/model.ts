import { Schema } from 'effect'

/**
 * Largest serialized scene (elements, images and app state together) one board may hold. Every dshx API call,
 * in and out, is capped at 1 MiB of JSON, so a scene must leave room in `read` for the queued source (at most
 * {@link pendingSourceLimit}) and the extracted texts (at most {@link textsByteLimit}).
 */
export const sceneByteLimit = 900 * 1024
/** Budget for the text list `read` returns beside the scene. */
export const textsByteLimit = 32 * 1024
/** Largest element count one write may carry. */
export const elementLimit = 20_000
/** Largest Mermaid definition or skeleton list an agent may queue for conversion. */
export const pendingSourceLimit = 64 * 1024

const positiveInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const countInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const boardIdSchema = Schema.String.check(Schema.isUUID())
export const boardTitleSchema = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(120))
/** The registered project root a board belongs to: an absolute POSIX or Windows path. */
export const projectPathSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096), Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/])/u))
export const revisionSchema = positiveInt

/** One Excalidraw element as JSON. The editor's own `restore()` fills missing fields, so the Host keeps it opaque. */
export const elementSchema = Schema.Record(Schema.String, Schema.Unknown)
export const elementsSchema = Schema.Array(elementSchema).check(Schema.isMaxLength(elementLimit))
/** Excalidraw `BinaryFiles`: image data keyed by file id. */
export const filesSchema = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
/** The persisted part of the editor state: background colour and grid, never selection or scroll. */
export const appStateSchema = Schema.Struct({
  viewBackgroundColor: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
  gridSize: Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)))),
})

export const sceneSchema = Schema.Struct({ elements: elementsSchema, appState: appStateSchema, files: filesSchema })
export type Scene = typeof sceneSchema.Type

/**
 * Source an agent wrote that only the browser editor can turn into elements: Mermaid needs a DOM to lay out, and
 * skeletons need Excalidraw's text measurement. The editor converts it the next time the board opens, appends the
 * result to the scene and clears it.
 */
export const pendingSourceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('mermaid'), source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(pendingSourceLimit)) }),
  Schema.Struct({ kind: Schema.Literal('skeleton'), elements: Schema.Array(elementSchema).check(Schema.isMinLength(1), Schema.isMaxLength(2_000)) }),
])
export type PendingSource = typeof pendingSourceSchema.Type

export const boardSummarySchema = Schema.Struct({
  id: boardIdSchema,
  project: projectPathSchema,
  title: boardTitleSchema,
  revision: revisionSchema,
  elementCount: countInt,
  pending: Schema.NullOr(Schema.Literals(['mermaid', 'skeleton'])),
  createdAt: countInt,
  updatedAt: countInt,
  deletedAt: Schema.NullOr(countInt),
})
export type BoardSummary = typeof boardSummarySchema.Type

export const boardSchema = Schema.Struct({
  board: boardSummarySchema,
  scene: sceneSchema,
  pending: Schema.NullOr(pendingSourceSchema),
  /** The text of every live text element, in scene order, so an agent can read a board without parsing elements. */
  texts: Schema.Array(Schema.String),
})
export type Board = typeof boardSchema.Type

export const emptyScene: Scene = { elements: [], appState: {}, files: {} }

/** Text an agent can read without walking element JSON: live `text` elements' `text`, else their `originalText`. */
export const sceneTexts = (elements: Scene['elements']): string[] => {
  const texts: string[] = []
  let bytes = 0
  for (const element of elements) {
    if (element['type'] !== 'text' || element['isDeleted'] === true) continue
    const text = typeof element['text'] === 'string' ? element['text'] : element['originalText']
    if (typeof text !== 'string' || text.trim() === '') continue
    bytes += new TextEncoder().encode(text).byteLength
    if (bytes > textsByteLimit) break
    texts.push(text)
  }
  return texts
}

/** Live (not deleted) elements: Excalidraw keeps deleted ones as tombstones for reconciliation. */
export const liveElementCount = (elements: Scene['elements']): number => elements.filter(element => element['isDeleted'] !== true).length
