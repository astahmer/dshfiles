import { describe, expect, expectTypeOf, it } from 'vitest'
import { createTestClient, createTestHost, mountPlugin } from '../src/testing/index.js'
import { definePlugin, defineTool } from '../src/host/index.js'
import { defineClientPlugin } from '../src/client/index.js'
import type { ClientContext } from '../src/client/types.js'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

describe('native SDK testing utilities', () => {
  it('uses the Client face for same-named Cordis services', () => {
    expectTypeOf<ClientContext['sessions']>().toEqualTypeOf<ISessions>()
  })

  it('derives Cordis service injection from declared Client capabilities', () => {
    const definition = defineClientPlugin({ id: 'capability-injection', uses: ['ui', 'panels', 'rpc'] })
    expect(definition.inject).toEqual(['slots', 'layout', 'connection'])
  })

  it('registers composer React actions into native session-scoped toolbar seats', async () => {
    const client = await createTestClient()
    try {
      client.slots.register(
        {
          name: 'root',
          children: {
            'conversation.input.left': { kind: 'list', scope: 'session' },
            'conversation.input.right': { kind: 'list', scope: 'session' },
          },
        },
        (props: PropsRenderSlots<'conversation.input.left' | 'conversation.input.right'>) => {
          void props.renderSlot
          return null
        },
      )
      const plugin = await client.mount(
        defineClientPlugin({
          id: 'composer-test',
          uses: ['composer'],
          setup(api) {
            api.composer.registerAction({
              id: 'magic',
              placement: 'right',
              component: props => {
                expectTypeOf(props.inputActions.setDraft).parameters.toEqualTypeOf<[text: string]>()
                return null
              },
            })
          },
        }),
      )
      expect(client.slots.entries('conversation.input.left')).toHaveLength(0)
      expect(client.slots.entries('conversation.input.right')).toHaveLength(1)
      await plugin.dispose()
      expect(client.slots.entries('conversation.input.right')).toHaveLength(0)
    } finally {
      await client.dispose()
    }
  })
  it('mounts native Host capabilities and removes tools and commands', async () => {
    const host = await createTestHost()
    try {
      const plugin = await mountPlugin(
        host,
        definePlugin({
          id: 'example',
          uses: ['commands', 'tools'],
          setup(api) {
            api.commands.register({
              name: 'example',
              description: 'Example',
              handler: () => ({ kind: 'success' }),
            })
            api.tools.register(
              defineTool({
                name: 'example_tool',
                description: 'Example',
                parameters: {},
                output: {
                  schema: { type: 'string' },
                  render: (_args, value) => [{ type: 'text', text: value }],
                },
                execute: async () => 'Hello',
              }),
            )
          },
        }),
      )
      expect(host.commands.get('example')).toBeDefined()
      expect(host.tools.get('example_tool')).toBeDefined()
      await plugin.dispose()
      expect(host.commands.get('example')).toBeUndefined()
      expect(host.tools.get('example_tool')).toBeUndefined()
    } finally {
      await host.dispose()
    }
  })

  it('uses the native slot registry through declaration loss, recreation, reload and unload', async () => {
    const client = await createTestClient()
    const declare = () =>
      client.slots.register(
        {
          name: 'root',
          children: {
            main: { kind: 'keyed', scope: 'root' },
            'sidebar.panellist': { kind: 'list', scope: 'root' },
          },
        },
        (props: PropsRenderSlots<'main' | 'sidebar.panellist'>) => {
          void props.renderSlot
          return null
        },
      )
    let rootDispose = declare()
    try {
      let raw: ClientContext | undefined
      const definition = defineClientPlugin({
        id: 'example',
        uses: ['ui'],
        setup(api) {
          raw = api.raw.ctx
          api.ui.register({ name: 'main', key: 'example' }, () => null)
          api.ui.register(
            {
              name: 'sidebar.panellist',
              id: 'example',
              order: 100,
              label: 'Example',
            },
            props => {
              expectTypeOf(props.size).toEqualTypeOf<number>()
              expectTypeOf(props.active).toEqualTypeOf<boolean>()
              return null
            },
          )
        },
      })
      const plugin = await client.mount(definition)
      expect(raw).toBe(plugin.ctx)
      expect(client.slots.entries('main')).toHaveLength(1)
      rootDispose()
      expect(client.slots.entries('main')).toHaveLength(0)
      rootDispose = declare()
      expect(client.slots.entries('main')).toHaveLength(1)
      await plugin.reload()
      expect(client.slots.entries('main')).toHaveLength(1)
      await plugin.dispose()
      expect(client.slots.entries('main')).toHaveLength(0)
      expect(client.slots.entries('sidebar.panellist')).toHaveLength(0)
    } finally {
      rootDispose()
      await client.dispose()
    }
  })
})
