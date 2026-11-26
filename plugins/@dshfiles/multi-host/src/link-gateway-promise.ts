import { Effect } from 'effect'

/**
 * The Promise edge of the link gateway: Node's HTTP callbacks answer with Promises and its service methods answer
 * without requirements, so both run in the services captured when the plugin activated.
 */
export const linkActivationContext = <R = never>() => Effect.context<R>()
