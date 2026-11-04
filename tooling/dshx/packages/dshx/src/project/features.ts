import { Result, SchemaIssue } from 'effect'
import * as Schema from 'effect/Schema'

const strictStruct = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct(fields).check(
    Schema.makeFilter(value => {
      const unknownKeys = Object.keys(value).filter(key => !Object.prototype.hasOwnProperty.call(fields, key))
      return unknownKeys.length === 0 || `Unrecognized key(s): ${unknownKeys.join(', ')}`
    }),
  )

const idPattern = /^[a-z0-9][a-z0-9.-]*$/
const scenarioIdSchema = Schema.String.check(Schema.isPattern(idPattern))

export const DshxFeatureSurfaceSchema = Schema.Literals(['client', 'host', 'tool', 'command', 'api', 'settings', 'storage', 'integration'])

/**
 * The presentation contract kind a feature contributes in the unified ADE shell (plans/ade-ux §5): where the shell
 * puts it, independent of the runtime `surfaces` that implement it. `agentToolOnly` is a capability with no UI of
 * its own beyond the agent tool; `infrastructure` is plumbing the user never addresses directly.
 */
export const DSHX_PRESENTATION_SURFACES = [
  'command',
  'destinationSection',
  'threadFacet',
  'detail',
  'rowDecorator',
  'rowAction',
  'transcriptCard',
  'composerContribution',
  'statusItem',
  'settingsSection',
  'attentionProvider',
  'entityProvider',
  'agentToolOnly',
  'infrastructure',
] as const
export const DshxPresentationSurfaceSchema = Schema.Literals(DSHX_PRESENTATION_SURFACES)
export type DshxPresentationSurface = (typeof DSHX_PRESENTATION_SURFACES)[number]

/**
 * The shell region a feature lands in (plans/ade-ux §4.2 rail destinations, plus the thread panel, composer and
 * transcript that belong to the active thread). `none` is for features with no place of their own: agent-tool-only
 * capabilities, infrastructure, palette-only commands and status-strip items.
 */
export const DSHX_DESTINATIONS = [
  'threads',
  'inbox',
  'land',
  'work',
  'agents',
  'observe',
  'knowledge',
  'settings',
  'thread-panel',
  'composer',
  'transcript',
  'none',
] as const
export const DshxDestinationSchema = Schema.Literals(DSHX_DESTINATIONS)
export type DshxDestination = (typeof DSHX_DESTINATIONS)[number]

/** Presentation fields `features:check` requires on every feature that is not in its grandfather baseline. */
export const DSHX_PRESENTATION_FIELDS = ['surface', 'destination', 'currentSurface'] as const

/**
 * A surface that only one destination can hold. Other surfaces may land in any destination; `agentToolOnly` and
 * `infrastructure` have no destination of their own.
 */
const destinationBySurface = new Map<DshxPresentationSurface, DshxDestination>([
  ['threadFacet', 'thread-panel'],
  ['transcriptCard', 'transcript'],
  ['composerContribution', 'composer'],
  ['settingsSection', 'settings'],
  ['attentionProvider', 'inbox'],
  ['agentToolOnly', 'none'],
  ['infrastructure', 'none'],
])

/** Destinations that belong to the active thread's own regions and take exactly one contribution kind. */
const surfaceByDestination = new Map<DshxDestination, DshxPresentationSurface>([
  ['thread-panel', 'threadFacet'],
  ['transcript', 'transcriptCard'],
  ['composer', 'composerContribution'],
])

/** Issues for a surface/destination pair that contradict each other, e.g. a thread facet outside the thread panel. */
const presentationPairIssue = (surface: DshxPresentationSurface, destination: DshxDestination): string | undefined => {
  const required = destinationBySurface.get(surface)
  if (required !== undefined && required !== destination) return `surface ${surface} lands in destination ${required}, not ${destination}`
  const only = surfaceByDestination.get(destination)
  if (only !== undefined && only !== surface) return `destination ${destination} holds only ${only} contributions, not ${surface}`
  return undefined
}

const verificationSchema = Schema.Union([
  strictStruct({ kind: Schema.Literal('gherkin'), id: scenarioIdSchema, featureFile: Schema.String.check(Schema.isMinLength(1)) }),
  strictStruct({
    kind: Schema.Literal('unit-test'),
    id: scenarioIdSchema,
    file: Schema.String.check(Schema.isMinLength(1)),
    testName: Schema.String.check(Schema.isMinLength(1)),
  }),
  strictStruct({
    kind: Schema.Literal('host-test'),
    id: scenarioIdSchema,
    file: Schema.String.check(Schema.isMinLength(1)),
    testName: Schema.String.check(Schema.isMinLength(1)),
  }),
  strictStruct({ kind: Schema.Literal('not-applicable'), id: scenarioIdSchema, reason: Schema.String.check(Schema.isMinLength(20)) }),
])

/**
 * Spans a feature's work emits without plugin code: `api-dispatch` (the `<api id>/<method>` server span of every dshx API
 * method the plugin serves), `agent-tool` (`execute_tool <name>` from agent-telemetry's `tools/execute` hook),
 * `model-stream` (`chat <model>` for a `ctx.llm` stream), and the shared helpers another owned plugin opens for it:
 * `jj` (jujutsu / jj-integration APIs), `secret` (`secretCatalogValues`), `multi-host` (gateway requests).
 */
export const DshxTelemetrySourceSchema = Schema.Literals(['api-dispatch', 'agent-tool', 'model-stream', 'jj', 'secret', 'multi-host'])

/** `<word>` marks a dynamic part of a span name (`jj <subcommand>`); everything else is literal. */
const spanNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.makeFilter(value => /^[a-z_<][a-z0-9_./ <>-]*$/u.test(value) || 'span names are lowercase `<subject> <verb>`; mark a dynamic part as <word>'),
)

const telemetrySchema = Schema.Union([
  strictStruct({ kind: Schema.Literal('automatic'), source: DshxTelemetrySourceSchema }),
  strictStruct({
    kind: Schema.Literal('custom'),
    span: spanNameSchema,
    file: Schema.String.check(Schema.isMinLength(1)),
    testName: Schema.String.check(Schema.isMinLength(1)),
  }),
  strictStruct({ kind: Schema.Literal('not-applicable'), reason: Schema.String.check(Schema.isMinLength(20)) }),
])

const ioDelegationSchema = strictStruct({
  file: Schema.String.check(Schema.isMinLength(1)),
  tracedBy: Schema.optional(spanNameSchema),
  reason: Schema.String.check(Schema.isMinLength(20)),
})

const configurationOptionSchema = strictStruct({
  key: Schema.String.check(Schema.isMinLength(1)),
  defaultValue: Schema.String,
  constraints: Schema.String.check(Schema.isMinLength(1)),
  choices: Schema.optional(Schema.Array(Schema.String)),
  coveredBy: Schema.Array(scenarioIdSchema).check(Schema.isMinLength(1)),
})

const externalDependencySchema = strictStruct({
  id: Schema.String.check(Schema.isMinLength(1)),
  boundary: Schema.String.check(Schema.isMinLength(1)),
  deterministicFake: Schema.String.check(Schema.isMinLength(1)),
})

/**
 * State a reach needs that one short UI path cannot create, set up by `dshx dev open`:
 * `shared-workspaces` creates five named workspaces on the scratch sample project's working copy;
 * `rebase-ready-thread` is a thread in its own jj workspace whose described revision is ready to rebase (the agent's edit
 * is stood in for by the jj CLI); `pending-restart` changes a loaded plugin's Host entry on disk, as a rebuild would;
 * `tool-call-thread` is a thread whose model (a loopback fake provider) ran a few-second `bash` tool call;
 * `jev-setup-chat-thread` is a natural-prompt thread on that loopback provider for inline Jev setup;
 * `quota-blocked-thread` is a thread whose exhausted fake-provider turn is stored for the Usage limit group;
 * `chat-reference-thread` is a thread in the scratch jj project whose transcript holds an explicit `` `jj:main` ``
 * reference, so the chat link is really rendered before the walk clicks it;
 * `fake-secret-cli` resets the synthetic store of a Host started with `up --fake-secret-cli`;
 * `backlog-jev-enabled` turns on Backlog Jev in scratch Settings only when off, without supplying a credential;
 * `multi-host-hosts` writes a synthetic host directory (one hidden host, one SSH host) for the Hosts page;
 * `queue-preview-thread` holds a fake-provider turn while queuing an image and file, for queue preview UI;
 * `otlp-sample-trace` posts one synthetic OTLP JSON trace (two services, a failing nested span) its logs and four metric exports to the traces receiver;
 * `otlp-session-turns` posts two synthetic agent turns (invoke_agent, chat with token usage, execute_tool with a nested
 * dshx span, one failed model attempt) and two logs tagged with the open thread's dsh.session.id, then returns to that thread;
 * `app-dialog-sample` opens a danger confirm and a sticky toast through the page's Dialogs and Toasts providers
 * (needs @dshfiles/dialogs), as another plugin's `api.dialogs.confirm` / `api.toast.show` call does.
 */
export const REACH_SEEDS = [
  'shared-workspaces',
  'rebase-ready-thread',
  'pending-restart',
  'tool-call-thread',
  'jev-setup-chat-thread',
  'quota-blocked-thread',
  'chat-reference-thread',
  'credential-recovery',
  'fake-secret-cli',
  'backlog-jev-enabled',
  'multi-host-hosts',
  'queue-preview-thread',
  'otlp-sample-trace',
  'otlp-session-turns',
  'app-dialog-sample',
] as const
export type ReachSeed = (typeof REACH_SEEDS)[number]

/** One point inside a locator's own box, in CSS pixels from its top-left corner. */
export interface ReachPosition {
  readonly x: number
  readonly y: number
}

/**
 * One user step toward a feature, run by `dshx dev open` from the app root:
 * `click|rightclick|hover <role|text|label|title> "<name>"`, `fill <role|label> "<name>" "<value>"` (the value may carry
 * `\"` and `\\` escapes, e.g. a tool directive whose JSON arguments need quotes),
 * `expect <role|text|label|title> "<name>"`, `press <key>` (Playwright key names, e.g. `Meta+K`), `attach "<file>"`, which
 * hands a repository file (path from the repository root) to the page's file input as the composer's file picker does,
 * or `seed <seed>` (before every other step). Names match exactly; a trailing `*` (`"sample*"`) matches a case-insensitive substring.
 * A pointer step may end with `at <x>,<y>` to hit that point of the element's own box: an overlay a row reveals on hover
 * (its action strip) intercepts the element's centre, while the row's left half is what a reader clicks.
 */
const reachStepPattern = new RegExp(
  `^(?:(?:click|rightclick|hover) [a-z]+ "[^"]+"(?: at \\d+,\\d+)?|expect [a-z]+ "[^"]+"|fill [a-z]+ "[^"]+" "(?:[^"\\\\]|\\\\.)*"|press [A-Za-z0-9+]+|attach "(?!\\/)(?!.*\\.\\.)[^"]+"|seed (?:${REACH_SEEDS.join('|')}))$`,
)

export const parseReachStep = (
  step: string,
):
  | { readonly action: 'click' | 'rightclick' | 'hover'; readonly by: string; readonly name: string; readonly position?: ReachPosition }
  | { readonly action: 'expect' | 'fill'; readonly by: string; readonly name: string; readonly value?: string }
  | { readonly action: 'press'; readonly key: string }
  | { readonly action: 'seed'; readonly seed: ReachSeed }
  | { readonly action: 'attach'; readonly file: string }
  | undefined => {
  if (!reachStepPattern.test(step)) return undefined
  const attach = /^attach "([^"]+)"$/.exec(step)
  if (attach?.[1] !== undefined) return { action: 'attach', file: attach[1] }
  const press = /^press (\S+)$/.exec(step)
  if (press?.[1] !== undefined) return { action: 'press', key: press[1] }
  const seed = REACH_SEEDS.find(candidate => step === `seed ${candidate}`)
  if (seed !== undefined) return { action: 'seed', seed }
  const match = /^(click|rightclick|hover|expect|fill) ([a-z]+) "([^"]+)"(?: "((?:[^"\\]|\\.)*)")?(?: at (\d+),(\d+))?$/.exec(step)
  const action = match?.[1]
  if (match === null || match[2] === undefined || match[3] === undefined) return undefined
  if (action !== 'click' && action !== 'rightclick' && action !== 'hover' && action !== 'expect' && action !== 'fill') return undefined
  if (action === 'fill' && match[2] === 'text') return undefined
  if (action === 'click' || action === 'rightclick' || action === 'hover') {
    const x = match[5]
    const y = match[6]
    return { action, by: match[2], name: match[3], ...(!(x === undefined || y === undefined) && { position: { x: Number(x), y: Number(y) } }) }
  }
  return { action, by: match[2], name: match[3], ...(match[4] !== undefined && { value: match[4].replace(/\\(.)/gu, '$1') }) }
}

const reachStepMessage = `reach steps are click/rightclick/hover <role|text|label|title> "<name>" (optionally "at <x>,<y>"), fill <role|label> "<name>" "<value>", press <key>, attach "<repository file>", or seed <${REACH_SEEDS.join('|')}>`

const reachSchema = Schema.Array(Schema.String.check(Schema.makeFilter(step => parseReachStep(step) !== undefined || reachStepMessage))).check(
  Schema.isMinLength(1),
  Schema.makeFilter(
    steps =>
      steps.slice(0, steps.findLastIndex(step => step.startsWith('seed ')) + 1).every(step => step.startsWith('seed ')) ||
      'seed steps come first: they set up state before the walk starts from the app root',
  ),
  Schema.makeFilter(steps => steps.at(-1)?.startsWith('expect ') === true || 'reach must end with an expect step that proves the feature is on screen'),
)

export const DshxFeatureSchema = strictStruct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)),
  title: Schema.String.check(Schema.isMinLength(1)),
  summary: Schema.String.check(Schema.isMinLength(1)),
  surfaces: Schema.Array(DshxFeatureSurfaceSchema).check(Schema.isMinLength(1)),
  configuration: Schema.Array(configurationOptionSchema),
  states: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
  failureModes: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
  externalDependencies: Schema.Array(externalDependencySchema),
  verification: Schema.Array(verificationSchema).check(Schema.isMinLength(1)),
  telemetry: Schema.Array(telemetrySchema).check(
    Schema.isMinLength(1),
    Schema.makeFilter(
      entries =>
        entries.length === 1 ||
        entries.every(entry => entry.kind !== 'not-applicable') ||
        'a not-applicable telemetry rationale stands alone: drop it or the span entries',
    ),
  ),
  reach: Schema.optional(reachSchema),
  /** Presentation contract kind in the unified shell; see {@link DSHX_PRESENTATION_SURFACES}. */
  surface: Schema.optional(DshxPresentationSurfaceSchema),
  /** Shell destination the feature lands in; see {@link DSHX_DESTINATIONS}. */
  destination: Schema.optional(DshxDestinationSchema),
  /** Where the feature lives today, as a user finds it (e.g. `left-nav: AI Accounts: Usage history`); feeds the migration map. */
  currentSurface: Schema.optional(Schema.String.check(Schema.isMinLength(3))),
})

export const DshxFeatureCatalogSchema = strictStruct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literals(['bundle', 'library', 'infrastructure']),
  features: Schema.Array(DshxFeatureSchema).check(Schema.isMinLength(1)),
  ioDelegation: Schema.optional(Schema.Array(ioDelegationSchema)),
})

export type DshxFeatureCatalog = Schema.Schema.Type<typeof DshxFeatureCatalogSchema>
export type DshxFeature = Schema.Schema.Type<typeof DshxFeatureSchema>

export const featureCatalogIssues = (value: unknown): readonly string[] => {
  const parsed = Schema.decodeUnknownResult(DshxFeatureCatalogSchema, { onExcessProperty: 'error' })(value)
  if (Result.isFailure(parsed)) {
    return SchemaIssue.makeFormatterStandardSchemaV1()(parsed.failure.issue).issues.map(issue => {
      const path = issue.path?.map(String).join('.') ?? ''
      return path === '' ? issue.message : `${path}: ${issue.message}`
    })
  }
  const featureIds = new Set<string>()
  const verificationIds = new Set<string>()
  const issues: string[] = []
  for (const feature of parsed.success.features) {
    if (featureIds.has(feature.id)) issues.push(`features.${feature.id}: duplicate feature id`)
    featureIds.add(feature.id)
    for (const verification of feature.verification) {
      if (verificationIds.has(verification.id)) issues.push(`features.${feature.id}.verification.${verification.id}: duplicate verification id`)
      verificationIds.add(verification.id)
    }
    if (feature.surface !== undefined && feature.destination !== undefined) {
      const pairIssue = presentationPairIssue(feature.surface, feature.destination)
      if (pairIssue !== undefined) issues.push(`features.${feature.id}.destination: ${pairIssue}`)
    }
    if (feature.surfaces.includes('tool') && !feature.telemetry.some(entry => entry.kind === 'automatic' && entry.source === 'agent-tool')) {
      issues.push(`features.${feature.id}.telemetry: a tool surface emits execute_tool spans; list { kind: automatic, source: agent-tool }`)
    }
    for (const option of feature.configuration) {
      const uncovered = option.coveredBy.filter(verificationId => !feature.verification.some(verification => verification.id === verificationId))
      if (uncovered.length > 0) {
        issues.push(
          `features.${feature.id}.configuration.${option.key}: coveredBy must refer to verification declared by this feature (${uncovered.join(', ')})`,
        )
      }
      if (option.choices !== undefined && option.choices.length > 0 && !option.choices.includes(option.defaultValue)) {
        issues.push(`features.${feature.id}.configuration.${option.key}: choices must include defaultValue`)
      }
    }
  }
  return issues
}
