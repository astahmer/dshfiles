import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sessionIdSchema = z.string().min(1).max(256)
const projectIdSchema = z.string().min(1).max(256)

const threadRowSchema = z
  .object({
    sessionId: z.string(),
    title: z.string().optional(),
    projectId: z.string().optional(),
    projectTitle: z.string().optional(),
    cwd: z.string().optional(),
    running: z.boolean(),
    liveAgent: z.boolean(),
    archived: z.boolean(),
    pinned: z.boolean(),
    settled: z.boolean(),
    updatedAt: z.number().optional(),
  })
  .strict()

const archivedSetSchema = z.object({ archivedSessionIds: z.array(z.string()).max(2000) }).strict()
const pinnedSetSchema = z.object({ pinnedSessionIds: z.array(z.string()).max(2000) }).strict()
const settledSetSchema = z.object({ settledSessionIds: z.array(z.string()).max(2000) }).strict()

const projectRowSchema = z.object({ projectId: z.string(), title: z.string(), path: z.string(), threadCount: z.number() }).strict()

const threadReferenceRowSchema = z
  .object({
    sessionId: z.string(),
    title: z.string().optional(),
    updatedAt: z.number().optional(),
    relation: z.enum(['fork', 'subagent', 'mention']),
  })
  .strict()

const threadReferencesSchema = z
  .object({
    sessionId: z.string(),
    references: z.array(threadReferenceRowSchema).max(20),
    omitted: z.number().int().min(0),
    degraded: z.boolean(),
  })
  .strict()

const renderReferences = (output: z.infer<typeof threadReferencesSchema>): string => {
  const header = `Threads that reference ${output.sessionId}${output.degraded ? ' (lineage only: the content search could not answer)' : ''}:`
  const rows = output.references.map(row => `${row.sessionId} · ${row.title ?? '(untitled)'} · ${row.relation}`)
  if (rows.length === 0) return `${header} none yet.`
  const omitted = output.omitted === 0 ? '' : `\n${output.omitted} more not shown.`
  return `${header}\n${rows.join('\n')}${omitted}`
}

const archiveResultSchema = z
  .object({
    status: z.enum(['archived', 'refused-active']),
    sessionId: z.string(),
    archivedSessionIds: z.array(z.string()).max(2000),
    activity: z.array(z.string()).max(16),
  })
  .strict()

const ONLY_WHEN_ASKED = 'Call only when the user asked for this.'

/** Thread and project lifecycle actions the sidebar exposes, served to the Agent as native tools. */
export const threadActionsApi = defineApi({
  id: 'thread-actions',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    list: method({
      input: z
        .object({
          query: z.string().max(200).optional(),
          includeArchived: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      output: z.object({ threads: z.array(threadRowSchema).max(200), total: z.number(), truncated: z.boolean() }).strict(),
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
      input: z.object({ sessionId: sessionIdSchema.optional(), stopActivity: z.boolean().optional() }).strict(),
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
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: z.object({ sessionId: z.string(), archivedSessionIds: archivedSetSchema.shape.archivedSessionIds }).strict(),
      description: `Restore an archived thread to its recorded place in the sidebar. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_unarchive', render: output => `Restored thread ${output.sessionId}.` },
    }),
    settle: method({
      input: z.object({ sessionId: sessionIdSchema.optional() }).strict(),
      output: z.object({ sessionId: z.string(), settledSessionIds: settledSetSchema.shape.settledSessionIds }).strict(),
      description: `Settle one thread: it stays listed and openable, but no model step starts — not from a message, a subagent settlement, a reminder or a queued follow-up — until thread_unsettle. Refuse while its own turn runs; stop it first. Defaults to the calling thread when sessionId is omitted. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_settle', render: output => `Settled thread ${output.sessionId}.` },
    }),
    unsettle: method({
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: z.object({ sessionId: z.string(), settledSessionIds: settledSetSchema.shape.settledSessionIds }).strict(),
      description: `Unsettle a settled thread so it can run model steps again. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_unsettle', render: output => `Unsettled thread ${output.sessionId}.` },
    }),
    pin: method({
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: z.object({ sessionId: z.string(), pinnedSessionIds: pinnedSetSchema.shape.pinnedSessionIds }).strict(),
      description: `Pin one thread ahead of the unpinned threads of its project. Refused while the thread is archived. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_pin', render: output => `Pinned thread ${output.sessionId}.` },
    }),
    unpin: method({
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: z.object({ sessionId: z.string(), pinnedSessionIds: pinnedSetSchema.shape.pinnedSessionIds }).strict(),
      description: `Remove one thread's pin. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_unpin', render: output => `Unpinned thread ${output.sessionId}.` },
    }),
    rename: method({
      input: z.object({ sessionId: sessionIdSchema.optional(), title: z.string().min(1).max(200) }).strict(),
      output: z.object({ sessionId: z.string(), title: z.string() }).strict(),
      description: `Rename one thread (its sidebar title). Defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_rename', render: output => `Renamed thread ${output.sessionId} to “${output.title}”.` },
    }),
    fork: method({
      input: z.object({ sessionId: sessionIdSchema.optional(), atSeq: z.number().int().min(0).optional() }).strict(),
      output: z.object({ sessionId: z.string(), forkedSessionId: z.string() }).strict(),
      description: `Fork one thread into a new independent thread at its latest completed turn, or at an exact inclusive event sequence with atSeq. Defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_fork',
        render: output => `Forked thread ${output.sessionId} into ${output.forkedSessionId}.`,
      },
    }),
    create: method({
      input: z
        .object({
          projectId: projectIdSchema.optional(),
          cwd: z.string().min(1).max(1024).optional(),
          title: z.string().min(1).max(200).optional(),
          agentPreset: z.string().min(1).max(128).optional(),
          text: z.string().min(1).max(20_000).optional(),
        })
        .strict(),
      output: z
        .object({
          sessionId: z.string(),
          title: z.string().optional(),
          agentPreset: z.string().optional(),
          prompt: z.enum(['accepted', 'refused']).optional(),
          promptError: z.string().optional(),
        })
        .strict(),
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
      input: z
        .object({
          sessionId: sessionIdSchema.optional(),
          text: z.string().min(1).max(20_000),
          mode: z.enum(['queue', 'steer']).optional(),
        })
        .strict(),
      output: z.object({ sessionId: z.string(), mode: z.enum(['queue', 'steer']), accepted: z.literal(true) }).strict(),
      description: `Hand a message to one thread: queue (the default) adds it as the thread's next turn and starts that turn when the thread is idle, so it is how an Agent follows up on a thread it started; steer folds it into the turn already running, which the Host refuses when no turn is live. Defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_prompt',
        render: output => `${output.mode === 'steer' ? 'Steered' : 'Queued a message for'} thread ${output.sessionId}.`,
      },
    }),
    stop: method({
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: z.object({ sessionId: z.string(), accepted: z.literal(true) }).strict(),
      description: `Stop one thread's running work through the same cancel path as the sidebar's stop: its current turn ends and the thread stays available. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'thread_stop', render: output => `Asked thread ${output.sessionId} to stop.` },
    }),
    selectModel: method({
      input: z
        .object({
          sessionId: sessionIdSchema.optional(),
          provider: z.string().min(1).max(128),
          model: z.string().min(1).max(256),
          reasoningEffort: z.string().min(1).max(64).optional(),
        })
        .strict(),
      output: z
        .object({
          sessionId: z.string(),
          provider: z.string(),
          model: z.string(),
          reasoningEffort: z.string().optional(),
        })
        .strict(),
      description: `Choose the provider, model and optional reasoning effort one thread uses for its next request. Defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_select_model',
        render: output =>
          `Thread ${output.sessionId} now uses ${output.provider}/${output.model}${output.reasoningEffort === undefined ? '' : ` at ${output.reasoningEffort} effort`}.`,
      },
    }),
    references: method({
      input: z.object({ sessionId: sessionIdSchema.optional(), limit: z.number().int().min(1).max(20).optional() }).strict(),
      output: threadReferencesSchema,
      description:
        'Threads that reference one thread (DSH Session): its forked and subagent children, plus the threads whose messages pulled it in as referenced context. Reports degraded: true with lineage only when the Host cannot search session content. Defaults to the calling thread. Read-only.',
      tool: { name: 'thread_references', readOnly: true, render: renderReferences },
    }),
    projectList: method({
      input: z.object({}).strict(),
      output: z.object({ projects: z.array(projectRowSchema).max(1000) }).strict(),
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
      input: z.object({ path: z.string().min(1).max(1024), title: z.string().min(1).max(200).optional() }).strict(),
      output: z.object({ projectId: z.string(), title: z.string(), path: z.string(), created: z.boolean() }).strict(),
      description: `Register an existing directory as a project so threads can live in it. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'project_register',
        render: output => `${output.created ? 'Registered' : 'Already registered'} project ${output.title} (${output.projectId}) at ${output.path}.`,
      },
    }),
    projectRename: method({
      input: z.object({ projectId: projectIdSchema, title: z.string().min(1).max(200) }).strict(),
      output: z.object({ projectId: z.string(), title: z.string() }).strict(),
      description: `Rename one project (its sidebar title); titles must be unique. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'project_rename',
        render: output => `Renamed project ${output.projectId} to “${output.title}”.`,
      },
    }),
    projectDelete: method({
      input: z.object({ projectId: projectIdSchema }).strict(),
      output: z.object({ projectId: z.string(), deleted: z.literal(true) }).strict(),
      description: `Remove one project registration: its directory and threads are kept, its threads simply lose the project grouping. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'project_delete',
        render: output => `Removed project registration ${output.projectId}; its files and threads are untouched.`,
      },
    }),
    projectReorder: method({
      input: z.object({ projectId: projectIdSchema, beforeProjectId: projectIdSchema.optional() }).strict(),
      output: z.object({ projectIds: z.array(z.string()).max(1000) }).strict(),
      description: `Move one project within the sidebar order: before another project, or to the end when beforeProjectId is omitted. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'project_reorder',
        render: output => `Project order is now: ${output.projectIds.join(', ')}.`,
      },
    }),
    move: method({
      input: z
        .object({
          sessionId: sessionIdSchema,
          projectId: projectIdSchema,
          beforeSessionId: sessionIdSchema.optional(),
        })
        .strict(),
      output: z.object({ sessionId: z.string(), projectId: z.string(), sessionIds: z.array(z.string()).max(5000) }).strict(),
      description: `Move one thread into a project, optionally before another thread of that project. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_move',
        render: output => `Moved thread ${output.sessionId} into project ${output.projectId}.`,
      },
    }),
  },
})
