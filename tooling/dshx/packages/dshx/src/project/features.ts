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
 * One user step toward a feature, run by `dshx dev open` from the app root:
 * `click <role|text|label> "<name>"`, `fill <role|label> "<name>" "<value>"`,
 * `expect <role|text|label> "<name>"` or `press <key>` (Playwright key names, e.g. `Meta+K`). Names match exactly;
 * a trailing `*` (`"sample*"`) matches a case-insensitive substring.
 */
const reachStepPattern = /^(?:(?:click|expect) [a-z]+ "[^"]+"|fill [a-z]+ "[^"]+" "[^"]*"|press [A-Za-z0-9+]+)$/

export const parseReachStep = (
  step: string,
):
  | { readonly action: 'click' | 'expect' | 'fill'; readonly by: string; readonly name: string; readonly value?: string }
  | { readonly action: 'press'; readonly key: string }
  | undefined => {
  if (!reachStepPattern.test(step)) return undefined
  const press = /^press (\S+)$/.exec(step)
  if (press?.[1] !== undefined) return { action: 'press', key: press[1] }
  const match = /^(click|expect|fill) ([a-z]+) "([^"]+)"(?: "([^"]*)")?$/.exec(step)
  const action = match?.[1]
  if (match === null || match[2] === undefined || match[3] === undefined) return undefined
  if (action !== 'click' && action !== 'expect' && action !== 'fill') return undefined
  if (action === 'fill' && match[2] === 'text') return undefined
  return { action, by: match[2], name: match[3], ...(match[4] === undefined ? {} : { value: match[4] }) }
}

const reachSchema = z
  .array(
    z
      .string()
      .refine(
        step => parseReachStep(step) !== undefined,
        'reach steps are click/expect <role|text|label> "<name>", fill <role|label> "<name>" "<value>", or press <key>',
      ),
  )
  .min(1)
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
