import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'
import { providerFetch } from './provider-request.js'

const OPENCODE_GO_MODELS_URL = 'https://opencode.ai/zen/go/v1/models'

const openCodeGoCatalogResponseSchema = Schema.Struct({
  data: AiAccountsSchema.list(Schema.Struct({ id: AiAccountsSchema.trimmedName(160) }), 500),
})

export const parseOpenCodeGoCatalog = (payload: unknown): readonly string[] => [
  ...new Set(AiAccountsSchema.decode(openCodeGoCatalogResponseSchema, payload).data.map(model => model.id)),
]

export const fetchOpenCodeGoCatalog = async (signal?: AbortSignal): Promise<readonly string[]> => {
  const timeout = AbortSignal.timeout(10_000)
  const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const response = await providerFetch({
    provider: 'opencode-go',
    operation: 'catalog',
    url: OPENCODE_GO_MODELS_URL,
    init: { headers: { accept: 'application/json' }, signal: requestSignal },
  })
  if (!response.ok) throw new Error(`OpenCode Go model catalog request failed (${response.status}).`)
  return parseOpenCodeGoCatalog(await response.json())
}
