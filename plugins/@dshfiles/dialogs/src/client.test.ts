import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { defineClientPlugin, Dialogs, Toasts, type DialogsService, type Live, type Subscribable, type ToastsService } from '@dshfiles/dshx/client'
import { createTestClient } from '@dshfiles/dshx/testing'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it } from 'vitest'
import dialogsPlugin from './client.js'

describe('provider registration', () => {
  it('makes Dialogs and Toasts active while mounted and withdraws them on dispose', async () => {
    const client = await createTestClient()
    let dialogs: Subscribable<Live<DialogsService>> | undefined
    let toasts: Subscribable<Live<ToastsService>> | undefined
    try {
      client.slots.register({ name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' } } }, (props: PropsRenderSlots<'shell.overlay'>) => {
        void props.renderSlot
        return null
      })
      await client.mount(
        defineClientPlugin({
          id: 'dialogs-consumer',
          uses: ['ui'],
          setup(api) {
            dialogs = api.use(Dialogs)
            toasts = api.use(Toasts)
          },
        }),
        { packageId: '@test/consumer' },
      )
      expect(dialogs?.get().status).toBe('pending')

      const mounted = await client.mount(dialogsPlugin, { packageId: '@dshfiles/dialogs' })
      expect(dialogs?.get()).toMatchObject({ status: 'active', owner: '@dshfiles/dialogs' })
      expect(toasts?.get()).toMatchObject({ status: 'active', owner: '@dshfiles/dialogs' })
      expect(client.slots.entries('shell.overlay')).toHaveLength(1)

      await mounted.dispose()
      expect(client.slots.entries('shell.overlay')).toHaveLength(0)
      expect(dialogs?.get()).toMatchObject({ status: 'inactive', reason: 'disabled' })
      expect(toasts?.get()).toMatchObject({ status: 'inactive', reason: 'disabled' })
    } finally {
      await client.dispose()
    }
  })
})
