import { defineApi, type ApiClient } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { projectConfigSchema } from './project-config.js'
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

/** Git's own clone stages, in the order it reports them. */
export const cloneStageSchema = Schema.Literals(['connecting', 'counting', 'receiving', 'resolving', 'checkout'])

export type CloneStage = typeof cloneStageSchema.Type

export const cloneJobSchema = Schema.Struct({
  id: Schema.String,
  repositoryUrl: Schema.String,
  path: Schema.String,
  state: cloneJobStateSchema,
  phase: clonePhaseSchema,
  progress: Schema.Struct({
    percent: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100))),
    stage: Schema.NullOr(cloneStageSchema),
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

/** What a folder is before it becomes a project, and whether Jujutsu can be enabled alongside its Git checkout. */
export const folderInspectionSchema = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(['none', 'git', 'jujutsu']),
  repositoryRoot: Schema.NullOr(Schema.String.check(Schema.isMaxLength(MAX_PATH_LENGTH))),
  remoteUrl: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_048))),
  defaultBranch: Schema.NullOr(Schema.String.check(Schema.isMaxLength(255))),
  gitAbove: Schema.Boolean,
  brokenJjMetadata: Schema.Boolean,
  canEnableJujutsu: Schema.Boolean,
  reason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(400))),
})

export type FolderInspection = typeof folderInspectionSchema.Type

const initializedProjectSchema = Schema.Struct({ path: Schema.String, workspaceId: Schema.String, title: Schema.String })

const projectConfigOutput = Schema.Struct({
  path: Schema.String,
  file: Schema.String,
  config: Schema.NullOr(projectConfigSchema),
  invalid: Schema.NullOr(Schema.String.check(Schema.isMaxLength(400))),
})

export type LoadedProjectConfigOutput = typeof projectConfigOutput.Type

const publishedProjectSchema = Schema.Struct({
  path: Schema.String,
  repository: Schema.String,
  pushed: Schema.Boolean,
  warning: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_000))),
})

const describeInspection = (inspection: FolderInspection): string => {
  const where = inspection.repositoryRoot ?? inspection.path
  const kind = inspection.kind === 'none' ? 'no repository' : inspection.kind === 'git' ? 'Git' : 'Jujutsu'
  const remote = inspection.remoteUrl === null ? '' : ` · ${inspection.remoteUrl}`
  const enable = inspection.canEnableJujutsu ? ' · Jujutsu can be enabled' : ''
  return `${kind} · ${where}${remote}${enable}`
}

export const projectToolsSchema = Schema.Struct({
  home: Schema.String,
  git: Schema.Boolean,
  jj: Schema.Boolean,
  gh: Schema.Boolean,
})

const jobsOutput = Schema.Struct({ jobs: Schema.Array(cloneJobSchema) })

const registeredProjectSchema = Schema.Struct({
  workspaceId: Schema.String.check(Schema.isMinLength(1)),
  title: Schema.String,
  path: Schema.String.check(Schema.isMinLength(1)),
})

const projectsOutput = Schema.Struct({ projects: Schema.Array(registeredProjectSchema).check(Schema.isMaxLength(1_000)) })

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
    retryClone: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ jobId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)) }),
      output: cloneJobSchema,
      description:
        'Retry a failed or cancelled clone into the same folder, as a new job; a running or succeeded job is refused. Follow it with project_clone_jobs. Call only when the user asked to retry that clone.',
      tool: { name: 'project_clone_retry', render: compact },
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
    inspect: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ path: parentPathSchema }),
      output: folderInspectionSchema,
      description:
        'Report what a folder is before it becomes a project: no repository, a Git checkout or a Jujutsu repository, its root, origin URL and default branch, and whether Jujutsu can be enabled alongside Git. Never writes. Read-only.',
      tool: { name: 'project_inspect', readOnly: true, render: describeInspection },
    }),
    initProject: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ path: parentPathSchema }),
      output: initializedProjectSchema,
      description:
        'Turn an existing folder into a project in place: jj git init (colocated), a README.md when it has none, a first described commit and a main bookmark, then register it as a project. Existing files are kept and become the first revision. Refuses a folder that is already a repository or sits inside one. Call only when the user asked to initialize that folder.',
      tool: { name: 'project_init', render: project => `Initialized ${project.path}` },
    }),
    readProjectConfig: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ path: parentPathSchema }),
      output: projectConfigOutput,
      description:
        'Read the dsh.project.json a repository declares at its root: icon path, default thread workspace, bookmark, trusted check ids and suggested scripts. A missing or invalid file is reported, never thrown; scripts in the file only run after the user imports them into the profile-trusted project checks. Read-only.',
      tool: {
        name: 'project_config_read',
        readOnly: true,
        render: output =>
          output.config === null
            ? `${output.path} · ${output.invalid ?? 'no dsh.project.json'}`
            : `${output.path} · workspace ${output.config.defaultThreadWorkspace ?? 'inherit'} · ${String(output.config.checks?.length ?? 0)} check(s)`,
      },
    }),
    projects: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({}),
      output: projectsOutput,
      description:
        'List registered projects (DSH Workspaces) on this machine with their workspace id, title and path, leaving out jj thread workspaces. Read-only.',
      tool: {
        name: 'project_projects',
        readOnly: true,
        render: output => output.projects.map(project => `${project.title} · ${project.path}`).join('\n') || 'No registered projects.',
      },
    }),
    projectIdentities: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ paths: Schema.Array(parentPathSchema).check(Schema.isMinLength(1), Schema.isMaxLength(100)) }),
      output: Schema.Struct({
        identities: Schema.Array(
          Schema.Struct({
            path: Schema.String.check(Schema.isMinLength(1)),
            /** Stable across checkouts of one repository: its origin, else the repository root, else the folder. */
            key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)),
            remoteUrl: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_048))),
            repositoryRoot: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_048))),
          }),
        ).check(Schema.isMaxLength(100)),
      }),
      description:
        'The repository identity behind each project folder: the Git/Jujutsu origin when there is one, else the repository root, else the folder itself, so two checkouts of one repository can group as one project. Cached on the Host. Read-only.',
      tool: {
        name: 'project_identities',
        readOnly: true,
        render: output => output.identities.map(identity => `${identity.path} → ${identity.key}`).join('\n'),
      },
    }),
    icon: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ path: parentPathSchema, title: Schema.optional(Schema.String.check(Schema.isMaxLength(200))) }),
      output: Schema.Struct({
        kind: Schema.Literals(['image', 'monogram']),
        value: Schema.String.check(Schema.isMaxLength(120_000)),
        mediaType: Schema.NullOr(Schema.Literals(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/x-icon'])),
        source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
      }),
      description:
        'The icon of the project at a folder: the iconPath declared in dsh.project.json, then a short list of conventional paths, then a monogram from the folder name. Cached on the Host. Read-only.',
      tool: {
        name: 'project_icon',
        readOnly: true,
        render: output => (output.kind === 'monogram' ? `Monogram ${output.value}` : `${output.source} (${output.mediaType ?? 'image'})`),
      },
    }),
    publishProject: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({
        path: parentPathSchema,
        visibility: Schema.Literals(['private', 'public']),
        bookmark: Schema.optional(WorkspaceFolderPickerSchema.trimmedText.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
      }),
      output: publishedProjectSchema,
      description:
        'Publish a local repository that has no origin: create the GitHub repository with the GitHub CLI, add it as origin and push the bookmark. visibility is required so nothing is created by default; a repository that already has an origin, or no commits, is refused with the next command. Call only when the user asked to publish that repository.',
      tool: { name: 'project_publish', render: project => `${project.repository}${project.pushed ? ' · pushed' : ''}` },
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
