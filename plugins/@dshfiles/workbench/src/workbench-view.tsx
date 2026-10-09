import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { PlusIcon, RotateCcwIcon } from '@dshfiles/plugin-ui/icons'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewTheme, type IDockviewPanelProps } from 'dockview-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { applyDefaultLayout, openPanel, restoreLayout, WORKBENCH_COMPONENT, type LayoutStore } from './layout-store.js'
import type { WorkbenchTranslate } from './locales.js'
import type { WorkbenchPanelRegistry } from './registry.js'

/** Variables live in the injected dockview sheet (`dockview-theme.css`), mapped to the Host `--dsw-*` tokens. */
const workbenchTheme: DockviewTheme = { name: 'dshfiles', className: 'dshfiles-workbench-theme' }

interface WorkbenchViewProps {
  readonly registry: WorkbenchPanelRegistry
  readonly store: LayoutStore
  readonly t: WorkbenchTranslate
  /** Receives the Dockview API once the saved layout is restored, for callers that drive the layout (commands, tests). */
  readonly onApi?: (api: DockviewApi) => void
}

const usePanelDefinitions = (registry: WorkbenchPanelRegistry) => useSyncExternalStore(registry.subscribe, registry.list, registry.list)

export const WorkbenchView = (props: WorkbenchViewProps): JSX.Element => {
  const { registry, store, t } = props
  const definitions = usePanelDefinitions(registry)
  const [api, setApi] = useState<DockviewApi | null>(null)
  const [openIds, setOpenIds] = useState<readonly string[]>([])

  const { components, Watermark } = useMemo(() => {
    const RegisteredPanel = (panelProps: IDockviewPanelProps): JSX.Element => {
      const id = panelProps.api.id
      const definition = useSyncExternalStore(
        registry.subscribe,
        () => registry.get(id),
        () => registry.get(id),
      )
      if (definition === undefined) {
        return (
          <div className="dshx-root dshx:flex dshx:h-full dshx:flex-col dshx:items-start dshx:gap-3 dshx:p-4 dshx:text-sm dshx:text-muted-foreground">
            <p>{t('missingPanel', { id })}</p>
            <Button size="sm" variant="outline" onClick={() => panelProps.api.close()}>
              {t('closePanel')}
            </Button>
          </div>
        )
      }
      const Panel = definition.component
      return <Panel panelId={id} />
    }
    const Watermark = (): JSX.Element => <p className="dshx-root dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{t('empty')}</p>
    return { components: { [WORKBENCH_COMPONENT]: RegisteredPanel }, Watermark }
  }, [registry, t])

  const onReady = (event: DockviewReadyEvent): void => {
    restoreLayout(event.api, store, registry.list())
    setApi(event.api)
    props.onApi?.(event.api)
  }

  useEffect(() => {
    if (api === null) return
    const syncOpenIds = (): void => setOpenIds(api.panels.map(panel => panel.id))
    syncOpenIds()
    const persist = api.onDidLayoutChange(() => {
      store.set(api.toJSON())
      syncOpenIds()
    })
    const takeOpenRequests = (): void => {
      for (const id of registry.takeOpenRequests()) openPanel(api, registry.get(id) ?? { id, title: id })
    }
    takeOpenRequests()
    const unsubscribe = registry.subscribe(takeOpenRequests)
    return () => {
      persist.dispose()
      unsubscribe()
    }
  }, [api, registry, store])

  const closed = definitions.filter(definition => !openIds.includes(definition.id))

  return (
    <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col">
      <header className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:border-b dshx:border-border dshx:px-3 dshx:py-1.5">
        <h2 className="dshx:text-sm dshx:font-medium">{t('title')}</h2>
        <div className="dshx:flex dshx:items-center dshx:gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={api === null}>
                <PlusIcon /> {t('addPanel')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {closed.length === 0 ? (
                <DropdownMenuItem disabled>{t('noMorePanels')}</DropdownMenuItem>
              ) : (
                closed.map(definition => (
                  <DropdownMenuItem key={definition.id} onSelect={() => api !== null && openPanel(api, definition)}>
                    {definition.title}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            disabled={api === null}
            onClick={() => {
              if (api === null) return
              store.remove()
              applyDefaultLayout(api, registry.list())
            }}
          >
            <RotateCcwIcon /> {t('resetLayout')}
          </Button>
        </div>
      </header>
      <div className="dshx:relative dshx:min-h-0 dshx:flex-1">
        <DockviewReact components={components} defaultRenderer="always" theme={workbenchTheme} watermarkComponent={Watermark} onReady={onReady} />
      </div>
    </div>
  )
}
