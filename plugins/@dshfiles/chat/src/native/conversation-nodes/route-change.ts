import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { chatNode } from './common.ts'

/** The model route one request ran on, as its `request/header` records it. */
export interface ChatRoute {
  readonly provider: string
  readonly model: string
  readonly effort?: string
}

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** The route of a request differs from the request before it: another account, model or reasoning effort. */
    'route-change': { readonly from: ChatRoute; readonly to: ChatRoute }
  }
}

interface RouteChangeState {
  readonly route: ChatRoute
  readonly previous: ChatRoute | undefined
}

const sameRoute = (left: ChatRoute, right: ChatRoute): boolean =>
  left.provider === right.provider && left.model === right.model && left.effort === right.effort

/**
 * What changed between two routes, one part per field, in reading order: the model, else the account (provider route)
 * serving the same model, then the effort. An effort the header leaves out is the route's default.
 * @returns `[from, to]` pairs; empty when nothing changed.
 */
export const routeChangeParts = (from: ChatRoute, to: ChatRoute): readonly { readonly field: 'model' | 'provider' | 'effort'; readonly from: string; readonly to: string }[] => {
  const parts: { field: 'model' | 'provider' | 'effort'; from: string; to: string }[] = []
  if (from.model !== to.model) parts.push({ field: 'model', from: from.model, to: to.model })
  else if (from.provider !== to.provider) parts.push({ field: 'provider', from: from.provider, to: to.provider })
  if (from.effort !== to.effort) parts.push({ field: 'effort', from: from.effort ?? 'default', to: to.effort ?? 'default' })
  return parts
}

/**
 * A marker where a request's route differs from the request before it. The Session logs a `request/header` only when
 * the request configuration changes, so this reads what each request actually ran on, fallbacks and account switches
 * included, not what the picker showed. The marker stays outside the Turn's fold so a collapsed Turn still shows it.
 * The first header of a loaded window has no predecessor and gets no marker.
 */
export const routeChangeDefinition: ConversationNodeDefinition<RouteChangeState> = {
  kind: 'route-change',
  target: 'chat',
  match: event => (event.type === 'request/header' ? { id: String(event.seq), role: 'start' } : null),
  start: (_context, match, reader) => {
    if (match.event.type !== 'request/header') throw new Error('route-change start requires request/header')
    const config = match.event.data.header.config
    const effort = config.reasoningEffort
    const route: ChatRoute = effort === undefined
      ? { provider: config.provider, model: config.model }
      : { provider: config.provider, model: config.model, effort: String(effort) }
    return { route, previous: reader.previous<RouteChangeState>('route-change')?.state.route }
  },
  update: context => context.state,
  buildViewNode: context => {
    const state = context.state
    const start = context.start
    if (state === undefined || start === undefined || state.previous === undefined || sameRoute(state.previous, state.route)) return null
    return chatNode(context, 'route-change', start.event.seq, { from: state.previous, to: state.route }, { groupTree: 'turn' })
  },
}

/**
 * Register the route-change marker in the Chat flow.
 * @param ctx - Owning UI Conversation context.
 */
export function registerRouteChangeConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(routeChangeDefinition)
}
