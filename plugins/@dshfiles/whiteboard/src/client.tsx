import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { PresentationIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'
import { useCallback, useMemo, useState, useSyncExternalStore, type JSX } from 'react'
import { whiteboardApi } from './api.js'
import { BoardView } from './board-view.js'
import { BoardsPanel } from './boards-panel.js'
import type { ProjectChoice, WhiteboardClient } from './ui-model.js'

const PANEL_ID = 'dshfiles-whiteboard'

/** The project last shown on this browser, so reopening the page lands on the same boards. */
const storedProject = createStoredValue({ key: 'dshfiles-whiteboard:project', schema: Schema.NullOr(Schema.String), fallback: null })

function WhiteboardPage(props: { readonly api: WhiteboardClient; readonly workspaces: Context['workspaces'] }): JSX.Element {
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
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => 'Whiteboard: Boards' }, () => (
        <PresentationIcon aria-hidden size={18} />
      )),
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
