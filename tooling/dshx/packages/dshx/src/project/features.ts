import { z } from 'zod'

const idPattern = /^[a-z0-9][a-z0-9.-]*$/
const scenarioIdSchema = z.string().regex(idPattern)

export const DshxFeatureSurfaceSchema = z.enum(['client', 'host', 'tool', 'command', 'api', 'settings', 'storage', 'integration'])

const verificationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gherkin'), id: scenarioIdSchema, featureFile: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('unit-test'), id: scenarioIdSchema, file: z.string().min(1), testName: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('host-test'), id: scenarioIdSchema, file: z.string().min(1), testName: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('not-applicable'), id: scenarioIdSchema, reason: z.string().min(20) }).strict(),
])

const configurationOptionSchema = z
  .object({
    key: z.string().min(1),
    defaultValue: z.string(),
    constraints: z.string().min(1),
    choices: z.array(z.string()).optional(),
    coveredBy: z.array(scenarioIdSchema).min(1),
  })
  .strict()

const externalDependencySchema = z
  .object({
    id: z.string().min(1),
    boundary: z.string().min(1),
    deterministicFake: z.string().min(1),
  })
  .strict()

/**
 * State a reach needs that one short UI path cannot create, set up once per scratch instance by `dshx dev open`:
 * `rebase-ready-thread` is a thread in its own jj workspace whose described revision is ready to rebase (the agent's edit
 * is stood in for by the jj CLI); `pending-restart` changes a loaded plugin's Host entry on disk, as a rebuild would;
 * `tool-call-thread` is a thread whose model (a loopback fake provider) ran a few-second `bash` tool call;
 * `quota-blocked-thread` is a thread whose exhausted fake-provider turn is stored for the Usage limit group;
 * `chat-reference-thread` is a thread in the scratch jj project whose transcript holds an explicit `` `jj:main` ``
 * reference, so the chat link is really rendered before the walk clicks it;
 * `fake-secret-cli` resets the synthetic store of a Host started with `up --fake-secret-cli`.
 */
export const REACH_SEEDS = [
  'rebase-ready-thread',
  'pending-restart',
  'tool-call-thread',
  'quota-blocked-thread',
  'chat-reference-thread',
  'credential-recovery',
  'fake-secret-cli',
] as const
export type ReachSeed = (typeof REACH_SEEDS)[number]

/** One point inside a locator's own box, in CSS pixels from its top-left corner. */
export interface ReachPosition {
  readonly x: number
  readonly y: number
}

/**
 * One user step toward a feature, run by `dshx dev open` from the app root:
 * `click|rightclick|hover <role|text|label|title> "<name>"`, `fill <role|label> "<name>" "<value>"`,
 * `expect <role|text|label|title> "<name>"`, `press <key>` (Playwright key names, e.g. `Meta+K`), `attach "<file>"`, which
 * hands a repository file (path from the repository root) to the page's file input as the composer's file picker does,
 * or `seed <seed>` (before every other step). Names match exactly; a trailing `*` (`"sample*"`) matches a case-insensitive substring.
 * A pointer step may end with `at <x>,<y>` to hit that point of the element's own box: an overlay a row reveals on hover
 * (its action strip) intercepts the element's centre, while the row's left half is what a reader clicks.
 */
const reachStepPattern = new RegExp(
  `^(?:(?:click|rightclick|hover) [a-z]+ "[^"]+"(?: at \\d+,\\d+)?|expect [a-z]+ "[^"]+"|fill [a-z]+ "[^"]+" "[^"]*"|press [A-Za-z0-9+]+|attach "(?!\\/)(?!.*\\.\\.)[^"]+"|seed (?:${REACH_SEEDS.join('|')}))$`,
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
  const match = /^(click|rightclick|hover|expect|fill) ([a-z]+) "([^"]+)"(?: "([^"]*)")?(?: at (\d+),(\d+))?$/.exec(step)
  const action = match?.[1]
  if (match === null || match[2] === undefined || match[3] === undefined) return undefined
  if (action !== 'click' && action !== 'rightclick' && action !== 'hover' && action !== 'expect' && action !== 'fill') return undefined
  if (action === 'fill' && match[2] === 'text') return undefined
  if (action === 'click' || action === 'rightclick' || action === 'hover') {
    const x = match[5]
    const y = match[6]
    return { action, by: match[2], name: match[3], ...(x === undefined || y === undefined ? {} : { position: { x: Number(x), y: Number(y) } }) }
  }
  return { action, by: match[2], name: match[3], ...(match[4] === undefined ? {} : { value: match[4] }) }
}

const reachSchema = z
  .array(
    z
      .string()
      .refine(
        step => parseReachStep(step) !== undefined,
        `reach steps are click/rightclick/hover <role|text|label|title> "<name>" (optionally "at <x>,<y>"), fill <role|label> "<name>" "<value>", press <key>, attach "<repository file>", or seed <${REACH_SEEDS.join('|')}>`,
      ),
  )
  .min(1)
  .refine(
    steps => steps.slice(0, steps.findLastIndex(step => step.startsWith('seed ')) + 1).every(step => step.startsWith('seed ')),
    'seed steps come first: they set up state before the walk starts from the app root',
  )
  .refine(steps => steps.at(-1)?.startsWith('expect ') === true, 'reach must end with an expect step that proves the feature is on screen')

export const DshxFeatureSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().min(1),
    summary: z.string().min(1),
    surfaces: z.array(DshxFeatureSurfaceSchema).min(1),
    configuration: z.array(configurationOptionSchema),
    states: z.array(z.string().min(1)).min(1),
    failureModes: z.array(z.string().min(1)).min(1),
    externalDependencies: z.array(externalDependencySchema),
    verification: z.array(verificationSchema).min(1),
    reach: reachSchema.optional(),
  })
  .strict()

export const DshxFeatureCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.enum(['bundle', 'library', 'infrastructure']),
    features: z.array(DshxFeatureSchema).min(1),
  })
  .strict()

export type DshxFeatureCatalog = z.infer<typeof DshxFeatureCatalogSchema>
export type DshxFeature = z.infer<typeof DshxFeatureSchema>

export const featureCatalogIssues = (value: unknown): readonly string[] => {
  const parsed = DshxFeatureCatalogSchema.safeParse(value)
  if (!parsed.success) return parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
  const featureIds = new Set<string>()
  const verificationIds = new Set<string>()
  const issues: string[] = []
  for (const feature of parsed.data.features) {
    if (featureIds.has(feature.id)) issues.push(`features.${feature.id}: duplicate feature id`)
    featureIds.add(feature.id)
    for (const verification of feature.verification) {
      if (verificationIds.has(verification.id)) issues.push(`features.${feature.id}.verification.${verification.id}: duplicate verification id`)
      verificationIds.add(verification.id)
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
