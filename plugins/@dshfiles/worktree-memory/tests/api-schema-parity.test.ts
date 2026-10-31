import '../../../../tooling/dshx/packages/dshx/src/effect/index.js'
import { publishedJsonSchema, toToolSchema } from '../../../../tooling/dshx/packages/dshx/src/api/json-schema.js'
import { describe, expect, it } from 'vitest'
import { worktreeMemoryApi } from '../src/api.js'

const schemaDump = (): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(worktreeMemoryApi.methods).map(([name, definition]) => {
        const input = publishedJsonSchema(definition.input, 'input') ?? null
        return [
          name,
          {
            description: definition.description,
            input,
            output: publishedJsonSchema(definition.output, 'output') ?? null,
            tool: definition.tool === undefined ? null : { ...definition.tool, schema: toToolSchema(input ?? undefined) },
          },
        ]
      }),
    ),
    null,
    2,
  )

describe('worktree memory API schema parity', () => {
  it('keeps the API and agent-tool schemas byte-identical', () => {
    expect(schemaDump()).toMatchSnapshot()
  })
})
