import type { AnyApiMethodDefinition, ApiContract, ApiHandler, ApiHandlerContext, ApiHostInput, ApiHostOutput } from '@dshfiles/dshx/api'
import { Effect } from 'effect'

export const effectHandler = <Methods extends Record<string, AnyApiMethodDefinition>, Key extends keyof Methods & string>(
  contract: ApiContract<Methods>,
  method: Key,
  handler: ApiHandler<ApiHostInput<Methods[Key]>, ApiHostOutput<Methods[Key]>>,
) =>
  Effect.fn(`ai accounts ${method.replace(/[A-Z]/gu, letter => ` ${letter.toLowerCase()}`)}`)((context: ApiHandlerContext<ApiHostInput<Methods[Key]>>) =>
    Effect.tryPromise({
      try: signal => Promise.resolve(handler({ ...context, signal })),
      catch: error => error,
    }),
  )
