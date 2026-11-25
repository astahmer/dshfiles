import { defineClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'
import type { EditorState } from './editor-store.js'
import type { OpenFileRequest } from './open-file.js'

const lineSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))

/**
 * The editor's client tools: read which files the user has open (the one they look at first), and open a file at a
 * line. Both act on the thread on screen, through the same store and open path the editor's own links use.
 * @param ports - the thread the editor follows, its store snapshot, and the editor's open path.
 * @returns the tools to add to `ClientTools`.
 */
const create = (ports: {
  readonly currentSession: () => string | undefined
  readonly state: () => EditorState
  readonly open: (request: OpenFileRequest) => boolean
}): readonly ClientToolItem[] => [
  defineClientTool({
    name: 'editor_files',
    title: 'List open files',
    description:
      'The files open in the user’s editor for the thread on screen, the active one first: workspace-relative path, absolute path, whether it has unsaved edits (dirty) or changed on disk since it was opened. Use it to know which file the user means by “this file”. Read-only.',
    readOnly: true,
    input: Schema.Struct({}),
    execute: () => {
      const sessionId = ports.currentSession()
      if (sessionId === undefined) return { sessionId: null, active: null, files: [] }
      const state = ports.state()
      const activeId = state.activeBySession[sessionId]
      const files = state.documents
        .filter(document => document.sessionId === sessionId)
        .map(document => ({
          path: document.path,
          absolutePath: document.absolutePath,
          active: document.id === activeId,
          dirty: document.dirty,
          diskChanged: document.diskChanged,
          status: document.status,
        }))
        .sort((left, right) => Number(right.active) - Number(left.active))
      return { sessionId, active: files.find(file => file.active)?.path ?? null, files }
    },
  }),
  defineClientTool({
    name: 'editor_open_file',
    title: 'Open a file in the editor',
    description:
      'Open a workspace file in the user’s editor beside the thread on screen, optionally scrolled to a line, as clicking a file link does. path is workspace-relative or absolute. Call only when the user asked to see or edit that file in their window.',
    readOnly: false,
    input: Schema.Struct({
      path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)).annotate({ description: 'File path, workspace-relative or absolute.' }),
      line: Schema.optionalKey(lineSchema).annotate({ description: '1-based line to reveal.' }),
    }),
    execute: input => {
      const request: OpenFileRequest = input.line === undefined ? { path: input.path } : { path: input.path, line: input.line }
      if (!ports.open(request)) throw new Error('No thread is on screen in this window, so the editor has no workspace to open the file in. Ask the user to open a thread, then retry.')
      return { opened: input.path, ...(input.line !== undefined && { line: input.line }), sessionId: ports.currentSession() ?? null }
    },
  }),
]

export class EditorClientTools {
  static readonly create = create
}
