import { defineApi, type ApiClient } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { WorkspaceFolderPickerSchema } from './schema.js'

const MAX_PATH_LENGTH = 4_096

const cloneUrlPattern = /^(?:https:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[A-Za-z0-9.-]+:[^\s]+|file:\/\/\/[^\s]+)$/u
const absolutePathPattern = /^(?:\/|~\/)/u
const folderNamePattern = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u

/** https, ssh (`ssh://` or `git@host:path`) or a local `file:///` URL; never a leading `-` git would read as an option. */
export const localCloneUrlSchema = WorkspaceFolderPickerSchema.trimmedText.check(
  Schema.isMinLength(8),
  Schema.isMaxLength(2_048),
  Schema.makeFilter(value => (cloneUrlPattern.test(value) ? true : 'Use an https://, ssh://, git@host:path or file:/// repository URL.')),
)

const parentPathSchema = WorkspaceFolderPickerSchema.trimmedText.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_PATH_LENGTH),
  Schema.makeFilter(value => (absolutePathPattern.test(value) ? true : 'Use an absolute or ~/ folder path.')),
  Schema.makeFilter(value => (value.split('/').includes('..') ? 'The folder path cannot contain "..".' : true)),
)

/** One new folder name: no separators, no leading dot or dash, so it cannot escape the parent or read as an option. */
export const projectFolderNameSchema = WorkspaceFolderPickerSchema.trimmedText.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.makeFilter(value => (folderNamePattern.test(value) ? true : 'Use letters, digits, ".", "_" or "-", starting with a letter, digit or "_".')),
)

const cloneJobStateSchema = Schema.Literals(['running', 'succeeded', 'failed', 'cancelled'])
const clonePhaseSchema = Schema.Literals(['cloning', 'colocating', 'registering', 'done'])

export const cloneJobSchema = Schema.Struct({
  id: Schema.String,
  repositoryUrl: Schema.String,
  path: Schema.String,
  state: cloneJobStateSchema,
  phase: clonePhaseSchema,
  progress: Schema.Struct({
    percent: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100))),
    message: Schema.String.check(Schema.isMaxLength(400)),
  }),
  startedAt: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
  finishedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
  workspaceId: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_000))),
})

export type CloneJob = typeof cloneJobSchema.Type

const createdProjectSchema = Schema.Struct({
  path: Schema.String,
  workspaceId: Schema.String,
  title: Schema.String,
  gitHubRepository: Schema.NullOr(Schema.String),
  warning: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_000))),
})

export type CreatedProject = typeof createdProjectSchema.Type

export const projectToolsSchema = Schema.Struct({
  home: Schema.String,
  git: Schema.Boolean,
  jj: Schema.Boolean,
  gh: Schema.Boolean,
})

const jobsOutput = Schema.Struct({ jobs: Schema.Array(cloneJobSchema) })

const compact = (job: CloneJob): string => `${job.state} · ${job.phase} · ${job.path}`

export const projectLifecycleApi = defineApi({
  id: 'workspace-folder-picker.project-lifecycle',
  version: 1,
  owner: '@dshfiles/workspace-folder-picker',
  methods: {
    tools: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({}),
      output: projectToolsSchema,
      description: 'Report the Host home folder and whether git, jj and the GitHub CLI (gh) are installed, for adding or creating a project. Read-only.',
      tool: { name: 'project_tools_status', readOnly: true, render: tools => `git ${String(tools.git)} · jj ${String(tools.jj)} · gh ${String(tools.gh)}` },
    }),
    startClone: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ repositoryUrl: localCloneUrlSchema, parentPath: parentPathSchema, name: projectFolderNameSchema }),
      output: cloneJobSchema,
      description:
        'Clone a Git repository into a new folder <parentPath>/<name> on this machine in the background, colocate jj when it is installed, and register the clone as a project. Returns the job at once; follow it with project_clone_jobs. Refuses an existing folder. Call only when the user asked to clone that repository.',
      tool: { name: 'project_clone', render: compact },
    }),
    cloneJobs: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({}),
      output: jobsOutput,
      description: 'Background clone jobs on this machine, newest first, with state, phase, progress and the error of a failed one. Read-only.',
      tool: { name: 'project_clone_jobs', readOnly: true, render: output => `${String(output.jobs.length)} clone job(s)` },
    }),
    cancelClone: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ jobId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)), confirm: Schema.Literal(true) }),
      output: cloneJobSchema,
      description:
        'Cancel one running clone job and delete the partly cloned folder it created; a finished job is returned unchanged. confirm: true is required. Call only when the user asked to cancel that clone.',
      tool: { name: 'project_clone_cancel', render: compact },
    }),
    createProject: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({
        parentPath: parentPathSchema,
        name: projectFolderNameSchema,
        createGitHubRepository: Schema.Boolean,
      }),
      output: createdProjectSchema,
      description:
        'Create a new project folder <parentPath>/<name>: jj git init (colocated), a README.md, a first described commit and a main bookmark, then register it as a project. createGitHubRepository: true also creates a PRIVATE GitHub repository with the GitHub CLI and pushes main; pass it only when the user asked for a GitHub repository. Refuses an existing folder. Call only when the user asked to create a project.',
      tool: {
        name: 'project_create',
        render: created => `Created ${created.path}${created.gitHubRepository === null ? '' : ` · ${created.gitHubRepository}`}`,
      },
    }),
    removeProject: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ workspaceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)) }),
      output: Schema.Struct({ workspaceId: Schema.String, removed: Schema.Literal(true) }),
      description:
        'Remove one project from the registered project list without deleting its folder or files. Its threads lose their project grouping. Call only when the user asked to remove that project.',
    }),
  },
})

export type ProjectLifecycleClient = ApiClient<(typeof projectLifecycleApi)['methods']>
