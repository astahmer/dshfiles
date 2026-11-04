import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import {
  appStateSchema,
  boardIdSchema,
  boardSchema,
  boardSummarySchema,
  boardTitleSchema,
  elementSchema,
  elementsSchema,
  filesSchema,
  pendingSourceLimit,
  projectPathSchema,
  revisionSchema,
} from './model.js'

const writeNote = 'Call only when the user asked for this whiteboard change.'

/** The one contract the Whiteboards page, other Host plugins and agent tools share. */
export const whiteboardApi = defineApi({
  id: 'whiteboard',
  version: 1,
  owner: '@dshfiles/whiteboard',
  methods: {
    list: method({
      input: Schema.Struct({
        project: Schema.optionalKey(projectPathSchema),
        includeDeleted: Schema.optionalKey(Schema.Boolean),
      }),
      output: Schema.Struct({ boards: Schema.Array(boardSummarySchema) }),
      description:
        'List whiteboards, newest first: id, project root path, title, revision, live element count and whether converted source is pending. Pass project (the absolute project root) to list one project; includeDeleted adds boards in Recently deleted. Read-only.',
      tool: { name: 'whiteboard_list', readOnly: true },
    }),
    read: method({
      input: Schema.Struct({ boardId: boardIdSchema }),
      output: boardSchema,
      description:
        'Read one whiteboard: its summary, the Excalidraw scene (elements, appState, files) as JSON, any Mermaid or skeleton source still waiting for the editor to convert it, and the text of every text element. Read-only.',
      tool: { name: 'whiteboard_read', readOnly: true },
    }),
    write: method({
      input: Schema.Struct({
        boardId: Schema.optionalKey(boardIdSchema),
        expectedRevision: Schema.optionalKey(revisionSchema),
        project: Schema.optionalKey(projectPathSchema),
        title: Schema.optionalKey(boardTitleSchema),
        elements: Schema.optionalKey(elementsSchema),
        appState: Schema.optionalKey(appStateSchema),
        files: Schema.optionalKey(filesSchema),
        mermaid: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(pendingSourceLimit))),
        skeleton: Schema.optionalKey(Schema.Array(elementSchema).check(Schema.isMinLength(1), Schema.isMaxLength(2_000))),
        clearPending: Schema.optionalKey(Schema.Literal(true)),
      }),
      output: boardSummarySchema,
      description: [
        'Create or update a whiteboard. Without boardId it creates one in project (absolute project root) with title.',
        'With boardId it updates that board and needs the expectedRevision from whiteboard_read or the previous write; a stale revision is refused rather than overwriting newer edits.',
        'elements replaces the scene with full Excalidraw element JSON (read, modify, write back); a scene, images included, must stay under 900 KiB.',
        'To draw from scratch prefer mermaid (a Mermaid flowchart, sequence or class diagram) or skeleton (Excalidraw element skeletons such as {type:"rectangle",x,y,width,height,label:{text}} and {type:"arrow",start:{id},end:{id}}): the Host stores that source and the editor converts and appends it the next time the board is opened, so whiteboard_read reports it as pending until then.',
        writeNote,
      ].join(' '),
      tool: { name: 'whiteboard_write' },
    }),
    rename: method({
      input: Schema.Struct({ boardId: boardIdSchema, expectedRevision: revisionSchema, title: boardTitleSchema }),
      output: boardSummarySchema,
      description: `Rename one whiteboard. Needs its current expectedRevision. ${writeNote}`,
      tool: { name: 'whiteboard_rename' },
    }),
    delete: method({
      input: Schema.Struct({ boardId: boardIdSchema, confirm: Schema.Literal(true) }),
      output: boardSummarySchema,
      description: `Move one whiteboard to Recently deleted. Requires confirm: true. The scene is kept; whiteboard_restore brings it back and whiteboard_list with includeDeleted shows it. ${writeNote}`,
      tool: { name: 'whiteboard_delete' },
    }),
    restore: method({
      input: Schema.Struct({ boardId: boardIdSchema }),
      output: boardSummarySchema,
      description: `Restore one whiteboard from Recently deleted, with its scene unchanged. ${writeNote}`,
      tool: { name: 'whiteboard_restore' },
    }),
  },
})
