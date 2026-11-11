import { SessionId } from '@dshfiles/dshx/ids'
import * as Schema from 'effect/Schema'
import type { CatalogFeature, FeatureCatalog } from './catalog-model.js'
import type { Pack } from './packs.js'
import { ReachModel } from './reach-model.js'

const featureKey = Schema.String.check(Schema.isMaxLength(160), Schema.isPattern(/^[a-z0-9][a-z0-9-]*#[a-z0-9][a-z0-9-]*$/u))
const packId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))

export const tryItInputSchema = Schema.Struct({
  /** A catalogued feature (`<plugin>#<feature>`, from onboarding_overview); give this or `pack`. */
  feature: Schema.optional(featureKey),
  /** A plugin pack id from onboarding_overview; give this or `feature`. */
  pack: Schema.optional(packId),
  /** No default: a request without it starts nothing. */
  confirm: Schema.Literal(true),
})
export type TryItInput = typeof tryItInputSchema.Type

export const tryItOutputSchema = Schema.Struct({
  sessionId: SessionId,
  title: Schema.String,
  /** `refused`: the thread exists but its first message was not accepted; `promptError` says why. */
  prompt: Schema.Literals(['accepted', 'refused']),
  promptError: Schema.NullOr(Schema.String),
})
export type TryItOutput = typeof tryItOutputSchema.Type

/** The onboarding `tryIt` setting is off: no thread was started. */
export class TryItOffError extends Schema.TaggedError<TryItOffError>()('TryItOffError', { message: Schema.String }, { dshxWireCode: 'try-it-off' }) {}

/** The request names no catalogued feature or pack, or both: no thread was started. */
export class TryItTargetError extends Schema.TaggedError<TryItTargetError>()(
  'TryItTargetError',
  { message: Schema.String },
  { dshxWireCode: 'try-it-target' },
) {}

/** Thread actions (thread-sidebar) is not running, or refused to create the thread. */
export class TryItUnavailableError extends Schema.TaggedError<TryItUnavailableError>()(
  'TryItUnavailableError',
  { message: Schema.String },
  { dshxWireCode: 'try-it-unavailable' },
) {}

export const TRY_IT_OFF_MESSAGE =
  'Try it is off, so no thread was started and no tokens were spent. The user can turn on Settings › Onboarding › tryIt (off by default); ask them first, because each demo is a new thread that runs on their model.'

export const TRY_IT_UNAVAILABLE_MESSAGE =
  'Try it starts threads through Thread actions, which is not running on this Host. Enable thread-sidebar in Settings › Plugins (Core pack), restart DSH, then try again.'

const TITLE_LIMIT = 80

const titleOf = (subject: string): string => `Try it · ${subject}`.slice(0, TITLE_LIMIT)

/** What the agent must do in every demo, whatever it shows. */
const RULES = [
  '## How to run this demo',
  '1. First call onboarding_overview (and onboarding_reach for a feature) to check what is installed and enabled here. If the feature or pack is missing or off, say so, say how to enable it, and stop.',
  '2. Show, do not change: use read-only tools, open or describe what I would see, and explain what each step does.',
  '3. Ask me before any write: no file edit, setting change, plugin install, command with side effects or new thread until I say yes in this thread.',
  '4. Keep it short. End with how I open this again myself and how I turn it off.',
] as const

/** One catalogued feature, from its catalog row and its `reach` steps as onboarding_reach describes them. */
const featurePrompt = (input: {
  readonly feature: Pick<CatalogFeature, 'key' | 'plugin' | 'title' | 'summary' | 'currentSurface' | 'onboarding'>
  readonly steps: readonly string[]
}): string => {
  const feature = input.feature
  const onboarding = feature.onboarding
  return [
    `Demonstrate one DSH feature to me in this setup: **${feature.title}** (plugin \`${feature.plugin}\`, catalog key \`${feature.key}\`).`,
    '',
    `What it does: ${feature.summary}`,
    ...(feature.currentSurface === null ? [] : [`Where it lives: ${feature.currentSurface}`]),
    ...(onboarding === null ? [] : [`First thing to try: ${onboarding.firstAction}`, `It worked when: ${onboarding.doneWhen}`]),
    ...(input.steps.length === 0 ? [] : ['', 'How to reach it in the app:', ...input.steps.map((step, index) => `${String(index + 1)}. ${step}`)]),
    '',
    ...RULES,
  ].join('\n')
}

/** One plugin pack, from its definition and each plugin's catalog description. */
const packPrompt = (input: {
  readonly pack: Pick<Pack, 'id' | 'title' | 'summary'>
  readonly plugins: readonly { readonly name: string; readonly description: string }[]
}): string =>
  [
    `Demonstrate one DSH plugin pack to me in this setup: **${input.pack.title}** (pack id \`${input.pack.id}\`).`,
    '',
    `What it is for: ${input.pack.summary}`,
    '',
    'Its plugins:',
    ...input.plugins.map(plugin => `- \`${plugin.name}\`${plugin.description === '' ? '' : `: ${plugin.description}`}`),
    '',
    'Pick the two or three features of this pack that matter most for a first look (onboarding_overview with the plugin name as `query` lists them) and show those.',
    '',
    ...RULES,
  ].join('\n')

export interface TryItDemo {
  readonly title: string
  readonly text: string
}

/**
 * The demo for one request, built only from the generated catalog and the pack definitions: the request picks an entry
 * by key, never supplies text. `null` when it names neither, both, or an unknown entry.
 */
const demoOf = (input: {
  readonly catalog: FeatureCatalog
  readonly packs: readonly Pack[]
  readonly request: Pick<TryItInput, 'feature' | 'pack'>
}): TryItDemo | null => {
  const request = input.request
  if ((request.feature === undefined) === (request.pack === undefined)) return null
  if (request.feature !== undefined) {
    const feature = input.catalog.features.find(candidate => candidate.key === request.feature)
    if (feature === undefined) return null
    const reach = ReachModel.reach({ catalog: input.catalog, key: feature.key, routeOf: () => null }).feature
    const steps = (reach?.steps ?? []).filter(step => step.unsupported === null).map(ReachModel.describeStep)
    return { title: titleOf(feature.title), text: featurePrompt({ feature, steps }) }
  }
  const pack = input.packs.find(candidate => candidate.id === request.pack)
  if (pack === undefined) return null
  const plugins = pack.plugins.map(name => ({ name, description: input.catalog.plugins.find(plugin => plugin.name === name)?.description ?? '' }))
  return { title: titleOf(pack.title), text: packPrompt({ pack, plugins }) }
}

const render = (value: TryItOutput): string =>
  value.prompt === 'accepted'
    ? `Started the demo thread ${value.sessionId} (“${value.title}”); its first message was sent and it is running on the user's default model.`
    : `Started thread ${value.sessionId} (“${value.title}”), but its first message was refused: ${value.promptError ?? 'no reason given'}. The thread is idle; archive it or send the message again.`

export class TryItModel {
  static readonly featurePrompt = featurePrompt
  static readonly packPrompt = packPrompt
  static readonly demoOf = demoOf
  static readonly render = render
}
