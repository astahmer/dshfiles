import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineClient, useSettings } from '@dshfiles/dshx/client'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { useEffect, useSyncExternalStore } from 'react'
import { z } from 'zod'
import './client.css'
import { createEditorStore } from './editor-store.js'
import { EditorPanel } from './editor-panel.js'
import { OPEN_FILE_EVENT, openFileRequestSchema } from './open-file.js'
import { editorSettings } from './settings.js'

const RIGHT_PANE_ID = '@dshfiles/editor/files'
const RIGHT_PANE_KIND = 'dshfiles-editor-files'
const WORKBENCH_PANEL_ID = 'dshfiles-editor.main'
const MONACO_STYLE_SELECTOR = 'style[data-dshfiles-monaco]'

// Open requests arrive while no editor surface is mounted, so the setting is mirrored where the event handler reads it.
const placement = createStoredValue({ key: 'dshfiles-editor:placement', schema: z.enum(['workbench', 'right-panel']), fallback: 'workbench' })

// Monaco stays in this one chunk (dshx forbids others); the dynamic import only defers evaluating it until a file opens.
const loadEngine = () => import('./monaco-engine.js').then(module => module.monacoEngine)

const noSession = (): undefined => undefined

export default defineClient({
  name: '@dshfiles/editor',
  inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'],
  setup(ctx, decorate) {
    const store = createEditorStore(ctx.remote)
    ctx.effect(
      () => () => {
        store.dispose()
        document.querySelector(MONACO_STYLE_SELECTOR)?.remove()
      },
      'dshfiles-editor: store and Monaco styles',
    )

    // The workbench lives in the main slot where no session is on screen, so both surfaces follow the last one shown.
    let lastSessionId = ctx.sidebarRight.mounted.getSnapshot()
    const sessionListeners = new Set<() => void>()
    ctx.effect(
      () =>
        ctx.sidebarRight.mounted.subscribe(() => {
          const next = ctx.sidebarRight.mounted.getSnapshot()
          if (next === undefined || next === lastSessionId) return
          lastSessionId = next
          for (const listener of sessionListeners) listener()
        }),
      'dshfiles-editor: follow the session on screen',
    )
    const subscribeSession = (listener: () => void): (() => void) => {
      sessionListeners.add(listener)
      return () => sessionListeners.delete(listener)
    }
    const currentSession = (): SessionId | undefined => lastSessionId

    const SessionEditorPanel = (): JSX.Element => {
      const sessionId = useSyncExternalStore(subscribeSession, currentSession, noSession)
      const configured = useSettings(editorSettings).value?.editorPlacement
      useEffect(() => {
        if (configured !== undefined) placement.set(configured)
      }, [configured])
      return <EditorPanel loadEngine={loadEngine} remote={ctx.remote} sessionId={sessionId} store={store} />
    }
    const Panel = decorate(() => (
      <PluginQueryProvider>
        <SessionEditorPanel />
      </PluginQueryProvider>
    ))

    // The workbench keeps moved panels mounted, so the Monaco instance and its view state survive docking changes.
    const workbench = workbenchPanels()
    ctx.effect(() => workbench.register({ id: WORKBENCH_PANEL_ID, title: 'Editor', component: Panel }), 'dshfiles-editor: workbench panel')
    const workbenchInstalled = (): boolean => workbench.list().some(panel => !panel.id.startsWith('dshfiles-editor.'))

    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: RIGHT_PANE_ID,
          kind: RIGHT_PANE_KIND,
          keepMounted: true,
          title: () => 'Editor',
          guide: [
            { id: 'editor', order: 45, title: () => 'Editor', description: () => 'Browse workspace files and edit them with Monaco.', icon: EditorGlyph },
          ],
        }),
      'dshfiles-editor: right pane tab type',
    )
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID }, Panel))

    ctx.effect(() => {
      const onOpenFile = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const request = openFileRequestSchema.safeParse(event.detail)
        const sessionId = currentSession()
        if (!request.success || sessionId === undefined) return
        event.preventDefault()
        store.open(sessionId, request.data)
        if (placement.get() === 'workbench' && workbenchInstalled()) workbench.open(WORKBENCH_PANEL_ID)
        else ctx.sidebarRight.openTab(RIGHT_PANE_KIND, { revealIfOpened: true })
      }
      window.addEventListener(OPEN_FILE_EVENT, onOpenFile)
      return () => window.removeEventListener(OPEN_FILE_EVENT, onOpenFile)
    }, 'dshfiles-editor: open-file requests')
  },
})

const EditorGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg
    aria-hidden
    fill="none"
    height={props.size ?? 18}
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="1.5"
    viewBox="0 0 24 24"
    width={props.size ?? 18}
  >
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M10 13l-2 2 2 2M14 13l2 2-2 2" />
  </svg>
)
