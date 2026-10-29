import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { HostDefinitionModel } from '../src/host/define.js'
import { createTestHost, type TestHost } from '../src/testing/index.js'

const hosts: TestHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose()
})

const echo = defineTool({
  name: 'acme_echo',
  description: 'Echo the text.',
  parameters: { text: { type: 'string', required: true } },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  execute: async args => String((args as { text: string }).text),
})

const host = async () => {
  const created = await createTestHost()
  hosts.push(created)
  await created.mount(HostDefinitionModel.define({ tools: [echo] }), { packageId: '@acme/echo' })
  return created
}

const run = (test: TestHost, text: string) =>
  test.tools.execute({ callId: `call-${text}` as never, name: 'acme_echo', arguments: { text }, signal: new AbortController().signal })

describe('defineHost hooks', () => {
  it('denies a tool call before it runs and rewrites the value after, until the plugin unloads', async () => {
    const test = await host()
    const hooks = await test.mount(
      HostDefinitionModel.define({
        hooks: {
          toolBefore: execution =>
            execution.arguments instanceof Object && 'text' in execution.arguments && execution.arguments.text === 'rm -rf'
              ? { kind: 'deny', reason: 'Not that one.' }
              : undefined,
          toolAfter: (_execution, result) => (result.isError ? undefined : { kind: 'accept', value: `${String(result.value)}!` }),
        },
      }),
      { packageId: '@acme/hooks' },
    )
    expect(await run(test, 'hi')).toMatchObject({ isError: false, value: 'hi!' })
    expect(await run(test, 'rm -rf')).toMatchObject({ isError: true, error: { message: expect.stringContaining('Not that one.') } })

    await hooks.dispose()
    expect(await run(test, 'hi')).toMatchObject({ isError: false, value: 'hi' })
    expect(await run(test, 'rm -rf')).toMatchObject({ isError: false, value: 'rm -rf' })
  })

  it('skips a hook that throws and lets the rest of the chain decide', async () => {
    const test = await host()
    await test.mount(
      HostDefinitionModel.define({
        hooks: {
          toolBefore: () => {
            throw new Error('broken policy')
          },
        },
      }),
      { packageId: '@acme/broken-hooks' },
    )
    expect(await run(test, 'hi')).toMatchObject({ isError: false, value: 'hi' })
  })

  it('rewrites the assembled system prompt, from a factory that reads the Host context', async () => {
    const test = await host()
    await test.mount(
      HostDefinitionModel.define({
        inject: ['systemPrompt'],
        hooks: ctx => ({
          systemPrompt: ({ assembly }) => ({ ...assembly, sections: [...assembly.sections, { name: 'acme:rule', text: `Root: ${ctx.root === ctx.root}` }] }),
        }),
      }),
      { packageId: '@acme/prompt-hooks' },
    )
    const assembly = await test.ctx.systemPrompt.assemble({})
    expect(assembly.sections.map(section => section.text)).toContain('Root: true')
  })

  it('refuses hooks that are not functions', async () => {
    const test = await host()
    await expect(test.mount({ hooks: { toolBefore: 'deny' } }, { packageId: '@acme/bad-hooks' })).rejects.toThrow('hooks must be an object of hook functions')
  })
})
