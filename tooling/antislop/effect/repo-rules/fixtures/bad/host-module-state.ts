import { Effect } from 'effect'

type Context = { readonly id: string }

let counter = 0
export let lastSeen: string | undefined
const runtimes = new WeakMap<Context, number>()

export const bump = (context: Context) => Effect.sync(() => runtimes.set(context, ++counter))
