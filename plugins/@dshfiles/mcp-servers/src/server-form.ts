import * as Schema from 'effect/Schema'
import * as SchemaIssue from 'effect/SchemaIssue'
import { httpDraftSchema, stdioDraftSchema, type ServerDraft, type ServerView } from './api.js'
import { McpCommandLineModel } from './command-line.js'
import { decodeJsonText } from './json-text.js'

const serverTransports = ['streamable-http', 'stdio'] as const

const serverFormValuesSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  serverName: Schema.String,
  enabled: Schema.Boolean,
  transport: Schema.Literals(serverTransports),
  url: Schema.String,
  headerRefs: Schema.String,
  oauth: Schema.Boolean,
  localStart: Schema.Boolean,
  startCommandLine: Schema.String,
  startCwd: Schema.String,
  startEnvRefs: Schema.String,
  commandLine: Schema.String,
  cwd: Schema.String,
  envRefs: Schema.String,
})

/** The form edits mutable fields, so the decoded `readonly` struct is widened for the form store. */
export type ServerFormValues = { -readonly [Key in keyof typeof serverFormValuesSchema.Type]: (typeof serverFormValuesSchema.Type)[Key] }
type ServerFormField = keyof ServerFormValues

interface ServerFormIssue {
  readonly field: ServerFormField | undefined
  readonly message: string
}

type ParsedServerForm = { readonly success: true; readonly draft: ServerDraft } | { readonly success: false; readonly issues: readonly ServerFormIssue[] }

const referenceTextSchema = Schema.Record(Schema.String, Schema.String)
const draftIssueFormatter = SchemaIssue.makeFormatterStandardSchemaV1()

const startCommandFields = { commandLine: 'startCommandLine', cwd: 'startCwd', envRefs: 'startEnvRefs' } as const satisfies Record<string, ServerFormField>
const draftFields = new Set<PropertyKey>(['name', 'serverName', 'url', 'headerRefs', 'commandLine', 'cwd', 'envRefs'])

const isServerFormField = (key: PropertyKey | undefined): key is ServerFormField => key !== undefined && draftFields.has(key)

type IssuePathSegment = PropertyKey | { readonly key: PropertyKey }

const pathKey = (segment: IssuePathSegment): PropertyKey | undefined => (typeof segment === 'object' && segment !== null ? segment.key : segment)

const formFieldForDraftPath = (path: readonly IssuePathSegment[]): ServerFormField | undefined => {
  const [head, nested] = path.map(pathKey)
  if (head === 'startCommand') return nested === 'cwd' || nested === 'envRefs' ? startCommandFields[nested] : startCommandFields.commandLine
  return isServerFormField(head) ? head : undefined
}

const referencesForPrefix = (server: ServerView, prefix: string): string =>
  JSON.stringify(
    Object.fromEntries(
      server.credentialReferences.filter(item => item.target.startsWith(prefix)).map(item => [item.target.slice(prefix.length), item.reference]),
    ),
    null,
    2,
  )

const commandArgv = (commandLine: string, issues: ServerFormIssue[]): readonly string[] => {
  try {
    return McpCommandLineModel.parseCommandLine(commandLine)
  } catch (error) {
    issues.push({ field: 'commandLine', message: error instanceof Error ? error.message : 'Enter a valid command line.' })
    return []
  }
}

export class McpServerFormModel {
  static readonly serverTransports = serverTransports

  static readonly serverNameFromTitle = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'mcp-server'

  /** A tool namespace derived from the title that no other configured server uses. */
  static readonly uniqueServerName = ({ title, taken }: { readonly title: string; readonly taken: readonly string[] }): string => {
    const base = McpServerFormModel.serverNameFromTitle(title)
    if (!taken.includes(base)) return base
    for (let index = 2; ; index += 1) {
      const suffix = `-${index}`
      const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`
      if (!taken.includes(candidate)) return candidate
    }
  }

  static readonly blankServerForm = (
    input: { readonly name?: string; readonly endpoint?: string; readonly oauth?: boolean; readonly headerRefs?: Record<string, string> } = {},
  ): ServerFormValues => ({
    id: '',
    name: input.name ?? '',
    serverName: McpServerFormModel.serverNameFromTitle(input.name ?? ''),
    enabled: true,
    transport: 'streamable-http',
    url: input.endpoint ?? '',
    headerRefs: input.headerRefs === undefined ? '{}' : JSON.stringify(input.headerRefs, null, 2),
    oauth: input.oauth ?? false,
    localStart: false,
    startCommandLine: '',
    startCwd: '',
    startEnvRefs: '{}',
    commandLine: '',
    cwd: '',
    envRefs: '{}',
  })

  /** Edit values for a saved server: credential reference names only, never resolved values. */
  static readonly serverFormFromView = (server: ServerView): ServerFormValues => {
    const base = { ...McpServerFormModel.blankServerForm(), id: server.id, name: server.name, serverName: server.serverName, enabled: server.enabled }
    if (server.transport === 'stdio') {
      return { ...base, transport: 'stdio', commandLine: server.commandLine, cwd: server.cwd, envRefs: referencesForPrefix(server, 'environment:') }
    }
    return {
      ...base,
      url: server.url,
      headerRefs: referencesForPrefix(server, 'header:'),
      oauth: server.oauth !== 'not-used',
      localStart: server.startCommand !== undefined,
      startCommandLine: server.startCommand?.commandLine ?? '',
      startCwd: server.startCommand?.cwd ?? '',
      startEnvRefs: referencesForPrefix(server, 'local-environment:'),
    }
  }

  static readonly inheritsHostWorkingDirectory = (values: ServerFormValues): boolean => values.transport === 'stdio' && values.cwd.trim() === ''

  /** Builds the API draft for the active transport only, so fields of the other transport never block saving. */
  static readonly parseServerForm = (values: ServerFormValues): ParsedServerForm => {
    const issues: ServerFormIssue[] = []
    const parseReferences = (field: ServerFormField): Record<string, string> => {
      const result = decodeJsonText(values[field], referenceTextSchema, 'Enter a JSON object of names to credential references.')
      if (result._tag === 'Success') return { ...result.success }
      issues.push({ field, message: result.failure.message })
      return {}
    }
    const base = { id: values.id, name: values.name, serverName: values.serverName, enabled: values.enabled }
    if (values.transport === 'stdio') {
      const argv = commandArgv(values.commandLine, issues)
      if (McpCommandLineModel.hasUnexpandedTilde(argv)) issues.push({ field: 'commandLine', message: McpCommandLineModel.UNEXPANDED_TILDE_MESSAGE })
    }
    const candidate =
      values.transport === 'stdio'
        ? { ...base, transport: values.transport, commandLine: values.commandLine, cwd: values.cwd, envRefs: parseReferences('envRefs') }
        : {
            ...base,
            transport: values.transport,
            url: values.url,
            headerRefs: parseReferences('headerRefs'),
            auth: values.oauth ? ('oauth' as const) : ('none' as const),
            startCommand: values.localStart ? { commandLine: values.startCommandLine, cwd: values.startCwd, envRefs: parseReferences('startEnvRefs') } : null,
          }
    const draftSchema = values.transport === 'stdio' ? stdioDraftSchema : httpDraftSchema
    const result = Schema.decodeUnknownResult(draftSchema, { onExcessProperty: 'error', errors: 'all' })(candidate)
    if (result._tag === 'Failure') {
      for (const issue of draftIssueFormatter(result.failure.issue).issues) {
        issues.push({ field: formFieldForDraftPath(issue.path ?? []), message: issue.message })
      }
    }
    if (result._tag === 'Success' && issues.length === 0) return { success: true, draft: result.success }
    return { success: false, issues }
  }

  /** One-click draft for a hosted endpoint from the provider catalog or the public Registry. */
  static readonly catalogServerDraft = (input: {
    readonly name: string
    readonly url: string
    readonly oauth: boolean
    readonly taken: readonly string[]
  }): ServerDraft => ({
    id: '',
    name: input.name,
    serverName: McpServerFormModel.uniqueServerName({ title: input.name, taken: input.taken }),
    enabled: true,
    transport: 'streamable-http',
    url: input.url,
    headerRefs: {},
    auth: input.oauth ? 'oauth' : 'none',
    startCommand: null,
  })

  static readonly serverFormSchema = serverFormValuesSchema.check(
    Schema.makeFilter((values: ServerFormValues) => {
      const parsed = McpServerFormModel.parseServerForm(values)
      if (parsed.success) return undefined
      return parsed.issues.map(issue => ({ path: issue.field === undefined ? [] : [issue.field], issue: issue.message }))
    }),
  )
}

/** The tanstack form validator: the same Effect schema, published as Standard Schema so errors keep their field path. */
export const serverFormValidator = Schema.toStandardSchemaV1(McpServerFormModel.serverFormSchema)
