import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { sidebarChildren } from './sidebar-contract.js'

const childSlotOwner = () => (_props: { readonly renderSlot: unknown }) => null

test('composition disables native declarations before the full sidebar can own them', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- id: ui-sidebar\s+disabled: true/)

  const slots = new SlotCore()
  slots.register(
    {
      name: 'root',
      children: { sidebar: { kind: 'single', scope: 'root' } },
    },
    childSlotOwner(),
  )

  const nativeComponent = childSlotOwner()
  const nativeDispose = slots.register(
    {
      name: 'sidebar',
      registrant: 'ui-sidebar',
      children: sidebarChildren,
    },
    nativeComponent,
  )

  assert.throws(
    () =>
      slots.register(
        {
          name: 'sidebar',
          priority: -1000,
          registrant: '@dshfiles/thread-sidebar',
          children: sidebarChildren,
        },
        childSlotOwner(),
      ),
    /already declared/,
  )

  nativeDispose()
  const sidebarComponent = childSlotOwner()
  slots.register(
    {
      name: 'sidebar',
      priority: -1000,
      registrant: '@dshfiles/thread-sidebar',
      children: sidebarChildren,
    },
    sidebarComponent,
  )

  const sidebarWinner = slots.entriesOfSlot('sidebar')[0]
  assert.equal(sidebarWinner?.component, sidebarComponent)
  assert.equal(sidebarWinner?.options.priority, -1000)

  const nativeWorkspaceBrowser = () => null
  const customThreadBrowser = () => null
  slots.register({ name: 'sidebar.workspaces', registrant: 'ui-workspace' }, nativeWorkspaceBrowser)
  slots.register({ name: 'sidebar.workspaces', priority: -1000, registrant: '@dshfiles/thread-sidebar' }, customThreadBrowser)

  const workspacesWinner = slots.entriesOfSlot('sidebar.workspaces')[0]
  assert.equal(workspacesWinner?.component, customThreadBrowser)
  assert.equal(workspacesWinner?.options.priority, -1000)
})
