import { Schema } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserBroker } from '../src/client/broker.js'
import { ClientTools, ClientToolsModel } from '../src/client/client-tools.js'

const openInput = Schema.Struct({ section: Schema.String.annotate({ description: 'Section id.' }), query: Schema.optionalKey(Schema.String) })

const openTool = (calls: unknown[]) =>
  ClientToolsModel.define({
    name: 'settings_open',
    title: 'Open Settings',
    description: 'Open Settings at a section. Call only when the user asked.',
    readOnly: false,
    input: openInput,
    execute: input => {
      calls.push(input)
      return { opened: input.section }
    },
  })

afterEach(() => BrowserBroker.reset())

describe('client tools', () => {
  it('describes a tool with the JSON Schema of its input', () => {
    const descriptor = ClientToolsModel.describe(openTool([]))
    expect(descriptor).toMatchObject({ name: 'settings_open', title: 'Open Settings', readOnly: false })
    expect(descriptor.inputSchema).toMatchObject({
      type: 'object',
      properties: { section: { type: 'string', description: 'Section id.' }, query: { type: 'string' } },
      required: ['section'],
    })
  })

  it('validates the input before running the tool', async () => {
    const calls: unknown[] = []
    const tool = openTool(calls)
    const signal = new AbortController().signal
    await expect(ClientToolsModel.run(tool, { section: 'market' }, { signal })).resolves.toEqual({ opened: 'market' })
    await expect(ClientToolsModel.run(tool, { section: 3 }, { signal })).rejects.toThrow(/validation failed/u)
    await expect(ClientToolsModel.run(tool, { section: 'market', extra: true }, { signal })).rejects.toThrow(/validation failed/u)
    expect(calls).toEqual([{ section: 'market' }])
  })

  it('does not run a call the Host already gave up on', async () => {
    const calls: unknown[] = []
    const controller = new AbortController()
    controller.abort(new Error('timed out'))
    await expect(ClientToolsModel.run(openTool(calls), { section: 'market' }, { signal: controller.signal })).rejects.toThrow('timed out')
    expect(calls).toEqual([])
  })

  it('refuses a name an Agent could not call', () => {
    expect(() => ClientToolsModel.define({ name: 'Open Settings', title: 'x', description: 'x', readOnly: true, input: openInput, execute: () => 1 })).toThrow(
      /must match/u,
    )
  })

  it('collects the tools every plugin adds to the page-wide registry', () => {
    const items = BrowserBroker.items(ClientTools)
    const entry = BrowserBroker.add(ClientTools, openTool([]), '@dshfiles/settings-shell')
    expect(items.get().map(item => item.name)).toEqual(['settings_open'])
    entry.remove()
    expect(items.get()).toEqual([])
  })
})
