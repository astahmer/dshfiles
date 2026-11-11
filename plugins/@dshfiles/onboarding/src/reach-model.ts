import * as Schema from 'effect/Schema'
import { REACH_ACTIONS, routeSchema, type CatalogFeature, type CatalogReachStep, type FeatureCatalog, type ReachAction, type Route } from './catalog-model.js'

/** Steps only the E2E harness can play: they create state or need a gesture this surface does not follow. */
export const UNREPLAYABLE_ACTIONS = ['seed', 'attach', 'rightclick', 'shiftclick'] as const satisfies readonly ReachAction[]
type UnreplayableAction = (typeof UNREPLAYABLE_ACTIONS)[number]

const UNREPLAYABLE_REASON = {
  seed: 'This step sets up sample data (a thread, a trace or a file) that only the test harness creates. Show me where stops here.',
  attach: "This step hands a repository file to the composer's file picker, which only the test harness does. Show me where stops here.",
  rightclick: 'This step right-clicks a row the test harness created for the test, so your screen holds a different one. Show me where stops here.',
  shiftclick: 'This step shift-clicks a range of rows the test harness created for the test. Show me where stops here.',
} as const satisfies Record<UnreplayableAction, string>

/** `b:#<n>` is the n-th backlog item a scratch profile captured; this profile's backlog holds other items. */
const SCRATCH_ORDINAL = /b:#\d/u
const SCRATCH_ORDINAL_REASON = 'This step names a backlog item the test harness captured; your backlog holds different ones. Show me where stops here.'

export const LOCATOR_KINDS = ['role', 'text', 'label', 'title'] as const
export const locatorSchema = Schema.Struct({
  kind: Schema.Literals(LOCATOR_KINDS),
  /** The ARIA role for a `role` locator; the grammar admits lowercase letters only. */
  role: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-z]+$/u))),
  name: Schema.String,
  /** A trailing `*` in the grammar asks for a case-insensitive substring; otherwise exact first, then substring. */
  match: Schema.Literals(['exact', 'substring']),
})
export type Locator = typeof locatorSchema.Type

export const walkStepSchema = Schema.Struct({
  index: Schema.Number,
  text: Schema.String,
  action: Schema.Literals(REACH_ACTIONS),
  locator: Schema.NullOr(locatorSchema),
  /** The fill text or the key to press. */
  value: Schema.NullOr(Schema.String),
  /** Why this surface cannot replay the step; `null` when it can. */
  unsupported: Schema.NullOr(Schema.String),
})
export type WalkStep = typeof walkStepSchema.Type

export const reachInputSchema = Schema.Struct({
  key: Schema.String.check(Schema.isMaxLength(160), Schema.isPattern(/^[a-z0-9][a-z0-9-]*#[a-z0-9][a-z0-9-]*$/u)),
})
export type ReachInput = typeof reachInputSchema.Type

export const featureReachSchema = Schema.Struct({
  key: Schema.String,
  plugin: Schema.String,
  title: Schema.String,
  destination: Schema.String,
  currentSurface: Schema.NullOr(Schema.String),
  route: Schema.NullOr(routeSchema),
  docsUrl: Schema.String,
  /** The first step can be replayed: the gallery shows Show me where. */
  walkable: Schema.Boolean,
  unsupportedActions: Schema.Array(Schema.Literals(REACH_ACTIONS)),
  /** The desktop walk (`reach`). */
  steps: Schema.Array(walkStepSchema),
  /** The phone walk (`reachNarrow`), at {@link PHONE_QUERY}; `null` walks `steps` on a phone too. */
  narrowSteps: Schema.NullOr(Schema.Array(walkStepSchema)),
})
export type FeatureReach = typeof featureReachSchema.Type

export const reachOutputSchema = Schema.Struct({ feature: Schema.NullOr(featureReachSchema) })
export type ReachOutput = typeof reachOutputSchema.Type

const REPOSITORY = 'https://github.com/astahmer/dshfiles/blob/main/plugins/@dshfiles'

const isUnreplayable = (action: ReachAction): action is UnreplayableAction => UNREPLAYABLE_ACTIONS.some(candidate => candidate === action)

const locatorOf = (step: CatalogReachStep): Locator | null => {
  if (step.by === null || step.name === null) return null
  const substring = step.name.endsWith('*')
  const name = substring ? step.name.slice(0, -1) : step.name
  const match = substring ? 'substring' : 'exact'
  if (step.by === 'text' || step.by === 'label' || step.by === 'title') return { kind: step.by, role: null, name, match }
  return { kind: 'role', role: step.by, name, match }
}

const unsupportedOf = (step: CatalogReachStep): string | null => {
  if (isUnreplayable(step.action)) return UNREPLAYABLE_REASON[step.action]
  if (SCRATCH_ORDINAL.test(step.text)) return SCRATCH_ORDINAL_REASON
  return null
}

const walkSteps = (reach: readonly CatalogReachStep[]): readonly WalkStep[] =>
  reach.map((step, index) => ({
    index,
    text: step.text,
    action: step.action,
    locator: locatorOf(step),
    value: step.action === 'fill' || step.action === 'press' ? step.value : null,
    unsupported: unsupportedOf(step),
  }))

const walkable = (feature: CatalogFeature): boolean => {
  const first = feature.reach[0]
  return first !== undefined && unsupportedOf(first) === null
}

const reachOf = (feature: CatalogFeature, route: Route | null): FeatureReach => {
  const steps = walkSteps(feature.reach)
  const narrowSteps = feature.reachNarrow === null ? null : walkSteps(feature.reachNarrow)
  const replayed = [...steps, ...(narrowSteps ?? [])]
  return {
    key: feature.key,
    plugin: feature.plugin,
    title: feature.title,
    destination: feature.destination,
    currentSurface: feature.currentSurface,
    route,
    docsUrl: `${REPOSITORY}/${feature.plugin}/README.md`,
    walkable: walkable(feature),
    unsupportedActions: REACH_ACTIONS.filter(action => replayed.some(step => step.action === action && step.unsupported !== null)),
    steps,
    narrowSteps,
  }
}

/**
 * The phone breakpoint of the shell: below 640 px thread-sidebar draws its bottom tab bar and settings-shell its Sections
 * combobox (both `(max-width: 639.98px)`, Tailwind's `sm`). Neither exports it and onboarding depends on neither.
 */
export const PHONE_QUERY = '(max-width: 639.98px)'

/** The steps a walk follows: `reachNarrow` on a phone when the feature has one, `reach` otherwise. */
const stepsFor = (input: { readonly reach: FeatureReach; readonly phone: boolean }): readonly WalkStep[] =>
  input.phone && input.reach.narrowSteps !== null ? input.reach.narrowSteps : input.reach.steps

/** `routeOf` is the gallery row's route, so Open in the walk is the Open the page shows. */
const reach = (input: { readonly catalog: FeatureCatalog; readonly key: string; readonly routeOf: (feature: CatalogFeature) => Route | null }): ReachOutput => {
  const feature = input.catalog.features.find(candidate => candidate.key === input.key)
  return { feature: feature === undefined ? null : reachOf(feature, input.routeOf(feature)) }
}

const VERB = {
  click: 'Click',
  rightclick: 'Right-click',
  shiftclick: 'Shift-click',
  hover: 'Point at',
  expect: 'Find',
  fill: 'Type into',
  press: 'Press',
  attach: 'Attach a file',
  seed: 'Set up sample data',
} as const satisfies Record<ReachAction, string>

/** `Click "Settings"`, `Type "max tabs" into "Search settings"`, `Press Meta+K`: what the chip and the Agent say. */
const describeStep = (step: WalkStep): string => {
  if (step.action === 'press') return `Press ${step.value ?? ''}`
  if (step.locator === null) return VERB[step.action]
  const target = `"${step.locator.name}"`
  if (step.action === 'fill') return `Type ${step.value === null || step.value === '' ? 'into' : `"${step.value}" into`} ${target}`
  return `${VERB[step.action]} ${target}`
}

const locatorLabel = (locator: Locator): string => (locator.kind === 'role' ? (locator.role ?? 'element') : locator.kind)

const renderSteps = (steps: readonly WalkStep[]): readonly string[] =>
  steps.map(
    step =>
      `${String(step.index + 1)}. ${describeStep(step)}${step.locator === null ? '' : ` (${locatorLabel(step.locator)})`}${step.unsupported === null ? '' : ` — not replayable here: ${step.unsupported}`}`,
  )

const render = (value: ReachOutput): string => {
  const feature = value.feature
  if (feature === null) return 'No catalogued feature has that key. Find it with onboarding_overview (its rows carry `key`).'
  const narrow = feature.narrowSteps
  return [
    `## ${feature.title} (${feature.plugin})`,
    `Lives in: ${feature.destination}${feature.currentSurface === null ? '' : ` — ${feature.currentSurface}`}`,
    ...(narrow === null
      ? renderSteps(feature.steps)
      : ['Desktop (640 px wide or more):', ...renderSteps(feature.steps), 'Phone (narrower than 640 px):', ...renderSteps(narrow)]),
    ...(feature.walkable ? [] : ['Show me where is not offered for this feature: its first step cannot be replayed in the app.']),
    `Docs: ${feature.docsUrl}`,
  ].join('\n')
}

export class ReachModel {
  static readonly reach = reach
  static readonly walkable = walkable
  static readonly stepsFor = stepsFor
  static readonly describeStep = describeStep
  static readonly locatorLabel = locatorLabel
  static readonly render = render
}
