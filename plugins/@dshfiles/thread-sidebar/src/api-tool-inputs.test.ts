import type { ApiSchema, PublishedJsonSchema } from '@dshfiles/dshx/api'
import { describe, expect, it } from 'vitest'
import { threadSidebarAttentionApi } from './attention-api.js'
import { threadSidebarAutoSettleApi } from './auto-settle-api.js'
import { threadSidebarNavigationApi } from './navigation-api.js'
import { threadSidebarRecoveryApi } from './recovery-api.js'
import { threadSubscriptionsApi } from './subscriptions-api.js'

interface StandardResult {
  readonly issues?: readonly object[]
}
/** The arguments these tests hand a method's input schema: none, `{}`, or a confirm flag with an extra key. */
type ToolArguments = { readonly confirm?: boolean; readonly extra?: number } | undefined
interface DshxSchemaInternals {
  readonly publishedJsonSchema: (schema: ApiSchema | undefined, io: 'input' | 'output') => PublishedJsonSchema | undefined
  readonly toToolSchema: (schema: PublishedJsonSchema | undefined) => { readonly type?: string }
  readonly resolveApiSchema: (schema: ApiSchema | undefined) => {
    readonly '~standard': { readonly validate: (value: ToolArguments) => StandardResult | Promise<StandardResult> }
  }
}

// The same projection and validation the dshx tool layer runs, read from its source (outside this package's rootDir).
const dshx = async (): Promise<DshxSchemaInternals> => {
  const jsonSchema = await import(new URL('../../../../tooling/dshx/packages/dshx/src/api/json-schema.ts', import.meta.url).href)
  const schema = await import(new URL('../../../../tooling/dshx/packages/dshx/src/api/schema.ts', import.meta.url).href)
  return { ...jsonSchema, ...schema }
}

const contracts = [threadSidebarAttentionApi, threadSidebarAutoSettleApi, threadSidebarNavigationApi, threadSidebarRecoveryApi, threadSubscriptionsApi]

interface ToolMethod {
  readonly input?: ApiSchema
  readonly tool?: { readonly name: string }
}

/** The tool layer passes the arguments only when the input publishes an object schema; otherwise it passes `undefined`. */
const toolMethods = contracts.flatMap(contract =>
  Object.entries<ToolMethod>(contract.methods).flatMap(([name, method]) =>
    method.tool === undefined ? [] : [{ tool: method.tool.name, name, input: method.input }],
  ),
)

describe('thread-sidebar agent tool inputs', () => {
  it.each(toolMethods)('$tool receives the arguments its contract validates', async ({ input }) => {
    const { publishedJsonSchema, toToolSchema, resolveApiSchema } = await dshx()
    const parameters = toToolSchema(publishedJsonSchema(input, 'input'))
    if (parameters.type === 'object') return
    // No published object schema: the tool calls the method with `undefined`, which the contract must accept.
    const result = await resolveApiSchema(input)['~standard'].validate(undefined)
    expect(result.issues).toBeUndefined()
  })

  it('shell_navigation_counts takes no arguments and shell_navigation_reset publishes confirm', async () => {
    const { publishedJsonSchema, toToolSchema, resolveApiSchema } = await dshx()
    const counts = threadSidebarNavigationApi.methods.counts.input
    // The tool passes `{}` for an object schema with no properties; the method must accept it.
    expect(toToolSchema(publishedJsonSchema(counts, 'input'))).toMatchObject({ type: 'object', properties: {} })
    expect((await resolveApiSchema(counts)['~standard'].validate({})).issues).toBeUndefined()
    const reset = toToolSchema(publishedJsonSchema(threadSidebarNavigationApi.methods.reset.input, 'input'))
    expect(reset).toMatchObject({ type: 'object', properties: { confirm: {} }, required: ['confirm'] })
    expect((await resolveApiSchema(threadSidebarNavigationApi.methods.reset.input)['~standard'].validate({ confirm: true, extra: 1 })).issues).toBeDefined()
  })
})
