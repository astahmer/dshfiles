import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))
const projectIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))

const threadRowSchema = Schema.Struct({
  sessionId: Schema.String,
  title: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  projectTitle: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  running: Schema.Boolean,
  liveAgent: Schema.Boolean,
  archived: Schema.Boolean,
  pinned: Schema.Boolean,
  settled: Schema.Boolean,
  updatedAt: Schema.optional(Schema.Number.check(Schema.isFinite())),
})

const archivedSessionIdsSchema = Schema.Array(Schema.String).check(Schema.isMaxLength(2000))
const pinnedSessionIdsSchema = Schema.Array(Schema.String).check(Schema.isMaxLength(2000))
const settledSessionIdsSchema = Schema.Array(Schema.String).check(Schema.isMaxLength(2000))

const projectRowSchema = Schema.Struct({
  projectId: Schema.String,
  title: Schema.String,
  path: Schema.String,
  threadCount: Schema.Number.check(Schema.isFinite()),
})

const threadReferenceRowSchema = Schema.Struct({
  sessionId: Schema.String,
  title: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.Number.check(Schema.isFinite())),
  relation: Schema.Literals(['fork', 'subagent', 'mention']),
})

const threadReferencesSchema = Schema.Struct({
  sessionId: Schema.String,
  references: Schema.Array(threadReferenceRowSchema).check(Schema.isMaxLength(20)),
  omitted: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  degraded: Schema.Boolean,
})

const renderReferences = (output: Schema.Schema.Type<typeof threadReferencesSchema>): string => {
  const header = `Threads that reference ${output.sessionId}${output.degraded ? ' (lineage only: the content search could not answer)' : ''}:`
  const rows = output.references.map(row => `${row.sessionId} · ${row.title ?? '(untitled)'} · ${row.relation}`)
  if (rows.length === 0) return `${header} none yet.`
  const omitted = output.omitted === 0 ? '' : `\n${output.omitted} more not shown.`
  return `${header}\n${rows.join('\n')}${omitted}`
}

const archiveResultSchema = Schema.Struct({
  status: Schema.Literals(['archived', 'refused-active']),
  sessionId: Schema.String,
  archivedSessionIds: Schema.Array(Schema.String).check(Schema.isMaxLength(2000)),
  activity: Schema.Array(Schema.String).check(Schema.isMaxLength(16)),
})

const fanOutModelSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
  model: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
  reasoningEffort: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))),
})

const ONLY_WHEN_ASKED = 'Call only when the user asked for this.'

/** Thread and project lifecycle actions the sidebar exposes, served to the Agent as native tools. */
export const threadActionsApi = defineApi({
  id: 'thread-actions',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    list: method({
      input: Schema.Struct({
        query: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
        includeArchived: Schema.optional(Schema.Boolean),
        limit: Schema.optional(
          Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(200)),
        ),
      }),
      output: Schema.Struct({
        threads: Schema.Array(threadRowSchema).check(Schema.isMaxLength(200)),
        total: Schema.Number.check(Schema.isFinite()),
        truncated: Schema.Boolean,
      }),
      description:
        'List threads (DSH Sessions) with title, project, running and pinned/archived/settled state. A settled thread is listed and openable but runs no model step until thread_unsettle. Use it to resolve which thread the user means before another thread_* or move call. Read-only.',
      tool: {
        name: 'thread_list',
        readOnly: true,
        render: output =>
          output.threads
            .map(thread => {
              const flags = [
                thread.running ? 'running' : 'idle',
                thread.archived ? 'archived' : undefined,
                thread.pinned ? 'pinned' : undefined,
                thread.settled ? 'settled' : undefined,
              ].filter(Boolean)
              return `${thread.sessionId} · ${thread.title ?? '(untitled)'} · ${thread.projectTitle ?? 'no project'} · ${flags.join(', ')}`
            })
            .join('\n') || 'No threads matched.',
      },
    }),
    archive: method({
      input: Schema.Struct({ sessionId: Schema.optional(sessionIdSchema), stopActivity: Schema.optional(Schema.Boolean) }),
      output: archiveResultSchema,
      description: `Archive one thread: it leaves the sidebar and its project groups until restored, and later wake-ups for it are blocked. Defaults to the calling thread when sessionId is omitted. A thread with running work is refused with the work named; pass stopActivity: true only when the user also asked to stop it, which stops its turn, subagent descendants, background jobs and schedules first — the sidebar's stop-and-archive confirmation. Archiving the calling thread always needs stopActivity: true and ends this turn. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_archive',
        render: output =>
          output.status === 'archived'
            ? `Archived thread ${output.sessionId}.`
            : `Thread ${output.sessionId} still runs: ${output.activity.join(', ') || 'unspecified work'}. Ask the user before stopping it, then call again with stopActivity: true.`,
      },
    }),
    unarchive: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: Schema.Struct({ sessionId: Schema.String, archivedSessionIds: archivedSessionIdsSchema }),
      description: `Restore an archived thread to its recorded place in the sidebar. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_unarchive', render: output => `Restored thread ${output.sessionId}.` },
    }),
    settle: method({
      input: Schema.Struct({ sessionId: Schema.optional(sessionIdSchema) }),
      output: Schema.Struct({ sessionId: Schema.String, settledSessionIds: settledSessionIdsSchema }),
      description: `Settle one thread: it stays listed and openable, but no model step starts — not from a message, a subagent settlement, a reminder or a queued follow-up — until thread_unsettle. Refuse while its own turn runs; stop it first. Defaults to the calling thread when sessionId is omitted. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_settle', render: output => `Settled thread ${output.sessionId}.` },
    }),
    unsettle: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: Schema.Struct({ sessionId: Schema.String, settledSessionIds: settledSessionIdsSchema }),
      description: `Unsettle a settled thread so it can run model steps again. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_unsettle', render: output => `Unsettled thread ${output.sessionId}.` },
    }),
    pin: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: Schema.Struct({ sessionId: Schema.String, pinnedSessionIds: pinnedSessionIdsSchema }),
      description: `Pin one thread ahead of the unpinned threads of its project. Refused while the thread is archived. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_pin', render: output => `Pinned thread ${output.sessionId}.` },
    }),
    unpin: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: Schema.Struct({ sessionId: Schema.String, pinnedSessionIds: pinnedSessionIdsSchema }),
      description: `Remove one thread's pin. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_unpin', render: output => `Unpinned thread ${output.sessionId}.` },
    }),
    rename: method({
      input: Schema.Struct({ sessionId: Schema.optional(sessionIdSchema), title: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200)) }),
      output: Schema.Struct({ sessionId: Schema.String, title: Schema.String }),
      description: `Rename one thread (its sidebar title). Defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_rename', render: output => `Renamed thread ${output.sessionId} to “${output.title}”.` },
    }),
    fork: method({
      input: Schema.Struct({
        sessionId: Schema.optional(sessionIdSchema),
        atSeq: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
      }),
      output: Schema.Struct({ sessionId: Schema.String, forkedSessionId: Schema.String }),
      description: `Fork one thread into a new independent thread at its latest completed turn, or at an exact inclusive event sequence with atSeq. Defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_fork',
        render: output => `Forked thread ${output.sessionId} into ${output.forkedSessionId}.`,
      },
    }),
    continueIn: method({
      input: Schema.Struct({
        sessionId: Schema.optional(sessionIdSchema),
        projectId: projectIdSchema,
        text: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(20_000))),
      }),
      output: Schema.Struct({
        sessionId: Schema.String,
        continuedSessionId: Schema.String,
        projectId: Schema.String,
        workspaceId: Schema.String,
        settled: Schema.Boolean,
        prompt: Schema.optional(Schema.Literals(['accepted', 'refused'])),
        promptError: Schema.optional(Schema.String),
      }),
      description: `Continue one thread in another project: fork its conversation into a new thread that runs in that project's own workspace (its isolated jj workspace when the project isolates new threads), then settle the original so it stays readable but runs no further step. Use it when a thread was started in the wrong folder or its work moved to another repository. Defaults to the calling thread: from inside a turn the new thread keeps this turn too, and this thread stops after the call. Another thread must be idle. text is queued as the new thread's first message. Get projectId from project_list. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_continue_in',
        render: output => {
          const head = `Thread ${output.sessionId} continues as ${output.continuedSessionId} in project ${output.projectId}${output.workspaceId === output.projectId ? '' : ` (workspace ${output.workspaceId})`}.`
          const settled = output.settled ? ' The original thread is settled.' : ' The original thread could not be settled; settle it with thread_settle.'
          if (output.prompt === 'accepted') return `${head}${settled} Its first message was accepted.`
          if (output.prompt === 'refused') return `${head}${settled} Its first message was refused: ${output.promptError ?? 'no reason given'}.`
          return `${head}${settled}`
        },
      },
    }),
    fanOut: method({
      input: Schema.Struct({
        projectId: Schema.optional(projectIdSchema),
        cwd: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(1024))),
        text: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(20_000)),
        models: Schema.Array(fanOutModelSchema).check(Schema.isMinLength(2)).check(Schema.isMaxLength(6)),
        titlePrefix: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(160))),
      }).check(
        Schema.makeFilter(input => (input.projectId === undefined || input.cwd === undefined ? undefined : 'Provide either projectId or cwd, not both.')),
      ),
      output: Schema.Struct({
        results: Schema.Array(
          Schema.Struct({
            provider: Schema.String,
            model: Schema.String,
            reasoningEffort: Schema.optional(Schema.String),
            sessionId: Schema.optional(Schema.String),
            ok: Schema.Boolean,
            error: Schema.optional(Schema.String),
          }),
        ).check(Schema.isMaxLength(6)),
      }),
      description: `Send one prompt to two through six models at once. Each model gets a new thread; its model is selected before the prompt is sent. Results report each thread and any per-model failure. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_fan_out',
        render: output =>
          output.results
            .map(result => `${result.provider}/${result.model}: ${result.ok ? `thread ${result.sessionId}` : (result.error ?? 'failed')}`)
            .join('\\n'),
      },
    }),
    create: method({
      input: Schema.Struct({
        projectId: Schema.optional(projectIdSchema),
        cwd: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(1024))),
        title: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200))),
        agentPreset: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128))),
        text: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(20_000))),
      }),
      output: Schema.Struct({
        sessionId: Schema.String,
        title: Schema.optional(Schema.String),
        agentPreset: Schema.optional(Schema.String),
        prompt: Schema.optional(Schema.Literals(['accepted', 'refused'])),
        promptError: Schema.optional(Schema.String),
      }),
      description: `Start a new thread in a project (projectId) or in a directory (cwd), which uses the project that owns it so the thread groups correctly, and optionally hand it its first message (text) in the same call: the thread's turn starts with that text instead of sitting idle, so no separate prompt call is needed. title applies when given; with only text the Host's automatic title stands, derived from that first message. Omitted text creates a blank thread, as before. A refused first message still returns the new thread id with prompt: 'refused' and the reason, so the created thread is never hidden. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_create',
        render: output => {
          const head = `Started thread ${output.sessionId}${output.title === undefined ? '' : ` named “${output.title}”`}${output.agentPreset === undefined ? '' : ` with preset ${output.agentPreset}`}.`
          if (output.prompt === 'accepted') return `${head} Its first message was accepted.`
          if (output.prompt === 'refused') {
            return `${head} Its first message was refused: ${output.promptError ?? 'no reason given'}. The thread exists and is idle; send the text with thread_prompt.`
          }
          return head
        },
      },
    }),
    prompt: method({
      input: Schema.Struct({
        sessionId: Schema.optional(sessionIdSchema),
        text: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(20_000)),
        mode: Schema.optional(Schema.Literals(['queue', 'steer'])),
      }),
      output: Schema.Struct({ sessionId: Schema.String, mode: Schema.Literals(['queue', 'steer']), accepted: Schema.Literal(true) }),
      description: `Hand a message to one thread: queue (the default) adds it as the thread's next turn and starts that turn when the thread is idle, so it is how an Agent follows up on a thread it started; steer folds it into the turn already running, which the Host refuses when no turn is live. Defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_prompt',
        render: output => `${output.mode === 'steer' ? 'Steered' : 'Queued a message for'} thread ${output.sessionId}.`,
      },
    }),
    stop: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: Schema.Struct({ sessionId: Schema.String, accepted: Schema.Literal(true) }),
      description: `Stop one thread's running work through the same cancel path as the sidebar's stop: its current turn ends and the thread stays available. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_stop', render: output => `Asked thread ${output.sessionId} to stop.` },
    }),
    selectModel: method({
      input: Schema.Struct({
        sessionId: Schema.optional(sessionIdSchema),
        provider: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
        model: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
        reasoningEffort: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))),
      }),
      output: Schema.Struct({
        sessionId: Schema.String,
        provider: Schema.String,
        model: Schema.String,
        reasoningEffort: Schema.optional(Schema.String),
      }),
      description: `Choose the provider, model and optional reasoning effort one thread uses for its next request. Defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_select_model',
        render: output =>
          `Thread ${output.sessionId} now uses ${output.provider}/${output.model}${output.reasoningEffort === undefined ? '' : ` at ${output.reasoningEffort} effort`}.`,
      },
    }),
    references: method({
      input: Schema.Struct({
        sessionId: Schema.optional(sessionIdSchema),
        limit: Schema.optional(
          Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(20)),
        ),
      }),
      output: threadReferencesSchema,
      description:
        'Threads that reference one thread (DSH Session): its forked and subagent children, plus the threads whose messages pulled it in as referenced context. Reports degraded: true with lineage only when the Host cannot search session content. Defaults to the calling thread. Read-only.',
      tool: { name: 'thread_references', readOnly: true, render: renderReferences },
    }),
    projectList: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ projects: Schema.Array(projectRowSchema).check(Schema.isMaxLength(1000)) }),
      description: 'List registered projects (DSH Workspaces): id, title, path and thread count. Read-only.',
      tool: {
        name: 'project_list',
        readOnly: true,
        render: output =>
          output.projects.map(project => `${project.projectId} · ${project.title} · ${project.path} · ${project.threadCount} threads`).join('\n') ||
          'No projects registered.',
      },
    }),
    projectRegister: method({
      input: Schema.Struct({
        path: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(1024)),
        title: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200))),
      }),
      output: Schema.Struct({ projectId: Schema.String, title: Schema.String, path: Schema.String, created: Schema.Boolean }),
      description: `Register an existing directory as a project so threads can live in it. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'project_register',
        render: output => `${output.created ? 'Registered' : 'Already registered'} project ${output.title} (${output.projectId}) at ${output.path}.`,
      },
    }),
    projectRename: method({
      input: Schema.Struct({ projectId: projectIdSchema, title: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200)) }),
      output: Schema.Struct({ projectId: Schema.String, title: Schema.String }),
      description: `Rename one project (its sidebar title); titles must be unique. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'project_rename',
        render: output => `Renamed project ${output.projectId} to “${output.title}”.`,
      },
    }),
    projectDelete: method({
      input: Schema.Struct({ projectId: projectIdSchema }),
      output: Schema.Struct({ projectId: Schema.String, deleted: Schema.Literal(true) }),
      description: `Remove one project registration: its directory and threads are kept, its threads simply lose the project grouping. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'project_delete',
        render: output => `Removed project registration ${output.projectId}; its files and threads are untouched.`,
      },
    }),
    projectReorder: method({
      input: Schema.Struct({ projectId: projectIdSchema, beforeProjectId: Schema.optional(projectIdSchema) }),
      output: Schema.Struct({ projectIds: Schema.Array(Schema.String).check(Schema.isMaxLength(1000)) }),
      description: `Move one project within the sidebar order: before another project, or to the end when beforeProjectId is omitted. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'project_reorder',
        render: output => `Project order is now: ${output.projectIds.join(', ')}.`,
      },
    }),
    move: method({
      input: Schema.Struct({
        sessionId: sessionIdSchema,
        projectId: projectIdSchema,
        beforeSessionId: Schema.optional(sessionIdSchema),
      }),
      output: Schema.Struct({ sessionId: Schema.String, projectId: Schema.String, sessionIds: Schema.Array(Schema.String).check(Schema.isMaxLength(5000)) }),
      description: `Reorder one thread within the project that already holds it, optionally before another thread of that project. It cannot move a thread to another project; thread_continue_in does that. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_move',
        render: output => `Moved thread ${output.sessionId} into project ${output.projectId}.`,
      },
    }),
  },
})
