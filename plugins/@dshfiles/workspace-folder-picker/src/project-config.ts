/**
 * `dsh.project.json` at a repository root: the checked-in settings a repository can declare about how it is worked in.
 * Published as the `@dshfiles/workspace-folder-picker/project-config` dshx module, so both the project lifecycle and
 * the Jujutsu bundle read one schema. Only non-executable settings live here: a script is a *suggestion* the user
 * imports into the trusted `project-checks` actions, never a command this file can make the Host run.
 */
import { Effect, FileSystem, Option, Schema } from 'effect'

export const PROJECT_CONFIG_FILE = 'dsh.project.json'

const trimmedText = (maxLength: number) => Schema.String.pipe(Schema.decodeTo(Schema.Trim)).check(Schema.isMinLength(1), Schema.isMaxLength(maxLength))

export const projectConfigScriptSchema = Schema.Struct({
  name: trimmedText(120),
  command: trimmedText(2_000),
  hint: Schema.optional(trimmedText(400)),
})

export const projectConfigSchema = Schema.Struct({
  /** Workspace-relative path to the project icon. */
  iconPath: Schema.optional(trimmedText(512)),
  /** Where new threads start for this repository; overrides the profile setting, never `isolate: true` at a call site. */
  defaultThreadWorkspace: Schema.optional(Schema.Literals(['isolated', 'shared'])),
  /** Bookmark Land advances and new thread workspaces start from. */
  bookmark: Schema.optional(trimmedText(200)),
  /** Ids of profile-trusted `project-checks` actions this repository offers in its composer menu. */
  checks: Schema.optional(Schema.Array(trimmedText(120)).check(Schema.isMaxLength(50))),
  /** Commands the repository suggests; they run only after the user imports them into the trusted actions. */
  scripts: Schema.optional(Schema.Array(projectConfigScriptSchema).check(Schema.isMaxLength(50))),
})

export type ProjectConfig = typeof projectConfigSchema.Type

export interface LoadedProjectConfig {
  /** The file name read, for the UI and the agent tool. */
  readonly file: string
  /** The declared settings, or null when the file is missing or invalid. */
  readonly config: ProjectConfig | null
  /** Why an existing file was ignored, or null when it loaded or does not exist. */
  readonly invalid: string | null
}

const invalidConfig = (file: string): LoadedProjectConfig => ({
  file,
  config: null,
  invalid: `${file} could not be read as a project config. Check its JSON against the published schema.`,
})

/**
 * Reads the file at a repository root. Never fails: missing or unreadable resolves as absent, and an invalid file
 * resolves with `invalid` set and no config, so a broken repository file can never break starting a thread.
 */
export const loadProjectConfig = (fs: FileSystem.FileSystem, workspaceRoot: string) =>
  Effect.gen(function* () {
    const file = `${workspaceRoot.replace(/[\\/]+$/u, '')}/${PROJECT_CONFIG_FILE}`
    const text = yield* fs.readFileString(file).pipe(
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none<string>()),
    )
    if (Option.isNone(text)) return { file, config: null, invalid: null } satisfies LoadedProjectConfig
    const parsed = yield* Effect.try({
      try: () => JSON.parse(text.value) as unknown,
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null))
    if (parsed === null) return invalidConfig(file)
    const decoded = Schema.decodeUnknownResult(projectConfigSchema)(parsed)
    return decoded._tag === 'Success' ? { file, config: decoded.success, invalid: null } : invalidConfig(file)
  })
