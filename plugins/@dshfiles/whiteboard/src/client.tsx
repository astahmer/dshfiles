import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { PresentationIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { workbenchPanels, type WorkbenchPanelProps } from '@dshfiles/workbench/registry'
import { useCallback, useMemo, useState, useSyncExternalStore, type JSX } from 'react'
import { whiteboardApi } from './api.js'
import { BoardView } from './board-view.js'
import { BoardsPanel } from './boards-panel.js'
import { projectPreferences } from './project-preferences.js'
import type { ProjectChoice, WhiteboardClient } from './ui-model.js'

const PANEL_ID = 'dshfiles-whiteboard'

function WhiteboardPage(props: { readonly api: WhiteboardClient; readonly workspaces: Context['workspaces']; readonly panelId?: string }): JSX.Element {
  const storedProject = useMemo(() => projectPreferences(props.panelId), [props.panelId])
  const subscribe = useCallback((listener: () => void) => props.workspaces.list.subscribe(listener), [props.workspaces])
  const read = useCallback(() => props.workspaces.list.getSnapshot(), [props.workspaces])
  const items = useSyncExternalStore(subscribe, read, read).items
  const projects: readonly ProjectChoice[] = useMemo(() => EntityLabels.projectsOf(items).map(item => ({ path: item.path, title: item.title })), [items])
  const remembered = storedProject.useValue()
  const project = projects.find(choice => choice.path === remembered)?.path ?? projects[0]?.path ?? null
  const [openBoardId, setOpenBoardId] = useState<string | null>(null)
  if (openBoardId !== null) return <BoardView api={props.api} boardId={openBoardId} onBack={() => setOpenBoardId(null)} />
  return (
    <BoardsPanel
      api={props.api}
      projects={projects}
      project={project}
      onProjectChange={next => storedProject.set(next)}
      onOpen={board => setOpenBoardId(board.id)}
    />
  )
}

export default defineClient({
  name: '@dshfiles/whiteboard',
  inject: ['slots', 'workspaces'],
  setup(ctx, decorate) {
    const api = createApiClient(ctx, whiteboardApi)
    const WorkbenchPanel = decorate((props: WorkbenchPanelProps) => (
      <PluginQueryProvider>
        <WhiteboardPage api={api} workspaces={ctx.workspaces} panelId={props.panelId} />
      </PluginQueryProvider>
    ))
    ctx.effect(
      () => workbenchPanels().register({ id: `main/${PANEL_ID}`, title: 'Whiteboard', mainPanelId: PANEL_ID, component: WorkbenchPanel }),
      'whiteboard: workbench panel',
    )
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => 'Whiteboard' }, () => <PresentationIcon aria-hidden size={18} />),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <WhiteboardPage api={api} workspaces={ctx.workspaces} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
