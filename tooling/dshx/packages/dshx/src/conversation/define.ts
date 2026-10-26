import type {
  ConversationMatch,
  ConversationNodeContext,
  ConversationNodeDefinition,
  ConversationPublication,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventType } from '@deepseek-ai/dsh-session/types'
import { createElement } from 'react'
import type {
  ConversationContribution,
  ConversationContributionParts,
  ConversationEventDescriptor,
  ConversationEventDescriptors,
  ConversationEventType,
  ConversationLifecycle,
  ConversationLifecycleDefinition,
  ConversationRendererComponent,
  ConversationRendererNode,
  ConversationRendererProps,
  ConversationRendererSlotProps,
} from './types.js'

type NoUnknownEventTypes<Events extends ConversationEventDescriptors> = Record<Exclude<keyof Events, SessionEventType>, never>

const PUBLICATIONS = new Set<ConversationPublication>(['none', 'animation-frame', 'immediate'])
const contributionParts = new WeakMap<object, ConversationContributionParts>()

/** What validateDefinition reads from one user-authored event descriptor. */
interface ConversationEventDescriptorInput {
  readonly role: 'start' | 'update'
  readonly id: (event: never) => string
  readonly publication?: ConversationPublication
}

const isObjectValue = (value: unknown): value is object => typeof value === 'object' && value !== null && !Array.isArray(value)

const isEventDescriptorInput = (value: unknown): value is ConversationEventDescriptorInput =>
  isObjectValue(value) &&
  'role' in value &&
  (value.role === 'start' || value.role === 'update') &&
  'id' in value &&
  typeof value.id === 'function'

function validateDefinition(definition: {
  readonly kind: string
  readonly events: object
  readonly initial: unknown
  readonly reduce?: unknown
  readonly project?: unknown
}): void {
  if (definition.kind.trim() === '') throw new TypeError('Conversation kind must be a non-empty string.')
  if (!isObjectValue(definition.events)) throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} events must be an object.`)
  const entries = Object.entries(definition.events)
  if (entries.length === 0) throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} must declare at least one event.`)
  let hasStart = false
  let hasUpdate = false
  for (const [type, value] of entries) {
    if (!isEventDescriptorInput(value)) {
      throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} event ${JSON.stringify(type)} must declare role and id(event).`)
    }
    if (value.role === 'start') hasStart = true
    else hasUpdate = true
    if (value.publication !== undefined && !PUBLICATIONS.has(value.publication)) {
      throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} event ${JSON.stringify(type)} has invalid publication.`)
    }
  }
  if (!hasStart) throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} must declare at least one start event.`)
  if (typeof definition.initial !== 'function') throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} initial must be a function.`)
  if (hasUpdate && typeof definition.reduce !== 'function') {
    throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} reduce must be a function when update events are declared.`)
  }
  if (definition.reduce !== undefined && typeof definition.reduce !== 'function')
    throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} reduce must be a function.`)
  if (definition.project !== undefined && typeof definition.project !== 'function')
    throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} project must be a function.`)
}

function locationOf<State>(context: ConversationNodeContext<State>) {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' as const }
}

function anchorOf<State>(context: ConversationNodeContext<State>): number {
  return context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0
}

function descriptorFor<Events extends ConversationEventDescriptors>(
  events: Events,
  event: { readonly type: string },
): ConversationEventDescriptor<ConversationEventType<Events>> | undefined {
  // SAFETY: the Session runtime only delivers an event whose type belongs to this definition's descriptor map.
  return events[event.type as ConversationEventType<Events>] as ConversationEventDescriptor<ConversationEventType<Events>> | undefined
}

function makeContribution<Kind extends string, Events extends ConversationEventDescriptors, State, Data>(
  lifecycle: ConversationLifecycle<Kind, Events, State, Data>,
  definitionOptions: ConversationLifecycleDefinition<Kind, Events, State, Data>,
  project: (state: State, context: ConversationNodeContext<State> & { readonly state: State }) => Data,
  authorComponent: ConversationRendererComponent<Kind, Data>,
): ConversationContribution<Kind, State, Data> {
  const definition: ConversationNodeDefinition<State> = {
    kind: lifecycle.kind,
    target: 'chat',
    match(event) {
      const descriptor = descriptorFor(lifecycle.events, event)
      if (descriptor === undefined) return null
      const id = descriptor.id(event as never)
      if (typeof id !== 'string')
        throw new TypeError(`Conversation ${JSON.stringify(lifecycle.kind)} event ${JSON.stringify(event.type)} returned a non-string id.`)
      return { id, role: descriptor.role }
    },
    start(context, match) {
      // SAFETY: the runtime starts this node only for a match this definition produced, so both carry its own types.
      return definitionOptions.initial(context as ConversationNodeContext<never>, match.event as never)
    },
    update(context, match) {
      if (definitionOptions.reduce === undefined) return context.state
      return definitionOptions.reduce(context.state, context, match.event as never)
    },
    buildViewNode(context) {
      if (context.state === undefined) return null
      // SAFETY: the guard above proves the runtime already reduced this node to State.
      const stateContext = context as ConversationNodeContext<State> & { readonly state: State }
      const data = project(context.state, stateContext)
      const node: ConversationRendererNode<Kind, Data> = {
        key: context.key,
        kind: lifecycle.kind,
        id: context.id,
        target: 'chat',
        anchorSeq: anchorOf(context),
        location: locationOf(context),
        visibility: 'visible',
        data,
      }
      return node
    },
    ...(Object.values(lifecycle.events).some(value => value?.publication !== undefined) && {
      publication(match: ConversationMatch) {
        return descriptorFor(lifecycle.events, match.event)?.publication ?? 'immediate'
      },
    }),
  }
  const renderer = (props: ConversationRendererSlotProps<Kind, Data>) =>
    // SAFETY: the runtime passes the slot props this renderer narrows, with the node data project() produced.
    createElement(authorComponent, { ...props, data: props.node.data } as ConversationRendererProps<Kind, Data>)
  // SAFETY: the empty object is an identity token; every part the runtime reads lives in contributionParts.
  const contribution = {} as ConversationContribution<Kind, State, Data>
  contributionParts.set(contribution, {
    definition,
    renderer: {
      name: 'conversation.chat.node',
      options: { key: lifecycle.kind, locale: 'conversation' },
      component: renderer,
    },
  })
  return contribution
}

function isConversationContribution(value: unknown): value is ConversationContribution {
  return typeof value === 'object' && value !== null && contributionParts.has(value)
}

function getConversationContributionParts(value: ConversationContribution): ConversationContributionParts {
  const parts = contributionParts.get(value)
  if (parts === undefined) throw new TypeError('Invalid Conversation contribution; use defineConversation(...).render(Component).')
  return parts
}

type ConversationDefinitionInput<Kind extends string, Events extends ConversationEventDescriptors, State, Data> = {
  readonly kind: Kind
  readonly events: Events & NoUnknownEventTypes<Events>
  readonly initial: (context: ConversationNodeContext<never>, event: import('./types.js').ConversationStartEvent<Events>) => State
  readonly reduce?: (
    state: State,
    context: ConversationNodeContext<State> & { readonly state: State },
    event: import('./types.js').ConversationUpdateEvent<Events>,
  ) => State
  readonly project?: (state: State, context: ConversationNodeContext<State> & { readonly state: State }) => Data
}

const identityProject = <State>(state: State, _context: ConversationNodeContext<State> & { readonly state: State }): State => state

/** Without `project`, the renderer receives the reduced state itself. */
function defineConversation<const Kind extends string, const Events extends ConversationEventDescriptors, State>(
  definition: ConversationDefinitionInput<Kind, Events, State, State>,
): ConversationLifecycle<Kind, Events, State, State>
function defineConversation<const Kind extends string, const Events extends ConversationEventDescriptors, State, Data>(
  definition: ConversationDefinitionInput<Kind, Events, State, Data> & {
    readonly project: (state: State, context: ConversationNodeContext<State> & { readonly state: State }) => Data
  },
): ConversationLifecycle<Kind, Events, State, Data>
function defineConversation(
  definition: ConversationDefinitionInput<string, ConversationEventDescriptors, unknown, unknown>,
): ConversationLifecycle<string, ConversationEventDescriptors, unknown, unknown> {
  validateDefinition(definition)
  const project = definition.project ?? identityProject
  const lifecycle: ConversationLifecycle<string, ConversationEventDescriptors, unknown, unknown> = {
    kind: definition.kind,
    events: definition.events,
    render(component) {
      if (typeof component !== 'function') throw new TypeError(`Conversation ${JSON.stringify(definition.kind)} renderer must be a component function.`)
      return makeContribution(lifecycle, definition, project, component)
    },
  }
  return lifecycle
}

export class ConversationContributionModel {
  static readonly isContribution = isConversationContribution
  static readonly parts = getConversationContributionParts
  static readonly define = defineConversation
}
