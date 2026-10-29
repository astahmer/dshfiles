import { defineApi, method, type ApiClient } from '@dshfiles/dshx/api'
import { z } from 'zod'

const MAX_PATH_LENGTH = 4_096

/** https, ssh (`ssh://` or `git@host:path`) or a local `file:///` URL; never a leading `-` git would read as an option. */
export const localCloneUrlSchema = z
  .string()
  .trim()
  .min(8)
  .max(2_048)
  .regex(
    /^(?:https:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[A-Za-z0-9.-]+:[^\s]+|file:\/\/\/[^\s]+)$/u,
    'Use an https://, ssh://, git@host:path or file:/// repository URL.',
  )

const parentPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .regex(/^(?:\/|~\/)/u, 'Use an absolute or ~/ folder path.')
  .refine(path => !path.split('/').includes('..'), 'The folder path cannot contain "..".')

/** One new folder name: no separators, no leading dot or dash, so it cannot escape the parent or read as an option. */
export const projectFolderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/u, 'Use letters, digits, ".", "_" or "-", starting with a letter, digit or "_".')

const cloneJobStateSchema = z.enum(['running', 'succeeded', 'failed', 'cancelled'])
const clonePhaseSchema = z.enum(['cloning', 'colocating', 'registering', 'done'])

export const cloneJobSchema = z
  .object({
    id: z.string(),
    repositoryUrl: z.string(),
    path: z.string(),
    state: cloneJobStateSchema,
    phase: clonePhaseSchema,
    progress: z.object({ percent: z.number().int().min(0).max(100).nullable(), message: z.string().max(400) }).strict(),
    startedAt: z.number().int(),
    finishedAt: z.number().int().nullable(),
    workspaceId: z.string().nullable(),
    error: z.string().max(1_000).nullable(),
  })
  .strict()

export type CloneJob = z.infer<typeof cloneJobSchema>

const createdProjectSchema = z
  .object({
    path: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    gitHubRepository: z.string().nullable(),
    warning: z.string().max(1_000).nullable(),
  })
  .strict()

export type CreatedProject = z.infer<typeof createdProjectSchema>

export const projectToolsSchema = z
  .object({
    home: z.string(),
    git: z.boolean(),
    jj: z.boolean(),
    gh: z.boolean(),
  })
  .strict()

const jobsOutput = z.object({ jobs: z.array(cloneJobSchema) }).strict()

const compact = (job: CloneJob): string => `${job.state} · ${job.phase} · ${job.path}`

export const projectLifecycleApi = defineApi({
  id: 'workspace-folder-picker.project-lifecycle',
  version: 1,
  owner: '@dshfiles/workspace-folder-picker',
  methods: {
    tools: method({
      input: z.object({}).strict(),
      output: projectToolsSchema,
      description: 'Report the Host home folder and whether git, jj and the GitHub CLI (gh) are installed, for adding or creating a project. Read-only.',
      tool: { name: 'project_tools_status', readOnly: true, render: tools => `git ${String(tools.git)} · jj ${String(tools.jj)} · gh ${String(tools.gh)}` },
    }),
    startClone: method({
      input: z.object({ repositoryUrl: localCloneUrlSchema, parentPath: parentPathSchema, name: projectFolderNameSchema }).strict(),
      output: cloneJobSchema,
      description:
        'Clone a Git repository into a new folder <parentPath>/<name> on this machine in the background, colocate jj when it is installed, and register the clone as a project. Returns the job at once; follow it with project_clone_jobs. Refuses an existing folder. Call only when the user asked to clone that repository.',
      tool: { name: 'project_clone', render: compact },
    }),
    cloneJobs: method({
      input: z.object({}).strict(),
      output: jobsOutput,
      description: 'Background clone jobs on this machine, newest first, with state, phase, progress and the error of a failed one. Read-only.',
      tool: { name: 'project_clone_jobs', readOnly: true, render: output => `${String(output.jobs.length)} clone job(s)` },
    }),
    cancelClone: method({
      input: z.object({ jobId: z.string().min(1).max(200), confirm: z.literal(true) }).strict(),
      output: cloneJobSchema,
      description:
        'Cancel one running clone job and delete the partly cloned folder it created; a finished job is returned unchanged. confirm: true is required. Call only when the user asked to cancel that clone.',
      tool: { name: 'project_clone_cancel', render: compact },
    }),
    createProject: method({
      input: z
        .object({
          parentPath: parentPathSchema,
          name: projectFolderNameSchema,
          createGitHubRepository: z.boolean(),
        })
        .strict(),
      output: createdProjectSchema,
      description:
        'Create a new project folder <parentPath>/<name>: jj git init (colocated), a README.md, a first described commit and a main bookmark, then register it as a project. createGitHubRepository: true also creates a PRIVATE GitHub repository with the GitHub CLI and pushes main; pass it only when the user asked for a GitHub repository. Refuses an existing folder. Call only when the user asked to create a project.',
      tool: {
        name: 'project_create',
        render: created => `Created ${created.path}${created.gitHubRepository === null ? '' : ` · ${created.gitHubRepository}`}`,
      },
    }),
  },
})

export type ProjectLifecycleClient = ApiClient<(typeof projectLifecycleApi)['methods']>
