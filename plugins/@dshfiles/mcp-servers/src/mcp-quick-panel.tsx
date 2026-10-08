import { GlobeIcon, PlusIcon, RefreshCwIcon, SearchIcon, SettingsIcon, SquareTerminalIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CatalogBrowser, SignInNotice, type CustomServerRequest } from './catalog-browser.js'
import type { McpServersTranslate } from './locales.js'
import type { QuickPanelState } from './quick-panel.js'
import { ServerEditorDialog } from './server-editor.js'
import { useServerActions, useServerSnapshot, type ServerActions } from './server-queries.js'
import { isClientActive, isConnectionToggleBlocked, lifecycleDotClassName, lifecycleText, localProcessText, matchesServerSearch } from './server-status.js'

export const McpQuickPanel = (props: { readonly t: McpServersTranslate; readonly panel: QuickPanelState; readonly onManage: () => void }): JSX.Element => {
  const t = props.t
  const open = useSyncExternalStore(props.panel.subscribe, props.panel.getSnapshot)
  const snapshot = useServerSnapshot()
  const actions = useServerActions()
  const [browsing, setBrowsing] = useState(false)
  const [custom, setCustom] = useState<(CustomServerRequest & { readonly key: number }) | null>(null)
  return (
    <>
      {open ? (
        <QuickPanelContent
          actions={actions}
          onBrowse={() => {
            props.panel.close()
            setBrowsing(true)
          }}
          onClose={() => props.panel.close()}
          onManage={() => {
            props.panel.close()
            props.onManage()
          }}
          t={t}
        />
      ) : null}
      <CatalogBrowser
        actions={actions}
        onClose={() => setBrowsing(false)}
        onCustom={request => {
          setBrowsing(false)
          setCustom(current => ({ ...request, key: (current?.key ?? 0) + 1 }))
        }}
        open={browsing}
        snapshot={snapshot.data}
        t={t}
      />
      {custom === null ? null : (
        <ServerEditorDialog
          hint={custom.hint}
          key={custom.key}
          onClose={() => setCustom(null)}
          onSave={async draft => {
            if (await actions.save(draft)) setCustom(null)
          }}
          open
          t={t}
          values={custom.values}
        />
      )}
    </>
  )
}

interface QuickPanelContentProps {
  readonly t: McpServersTranslate
  readonly actions: ServerActions
  readonly onClose: () => void
  readonly onManage: () => void
  readonly onBrowse: () => void
}

const QuickPanelContent = ({ t, actions, ...props }: QuickPanelContentProps): JSX.Element => {
  const snapshot = useServerSnapshot()
  const sectionRef = useRef<HTMLElement>(null)
  const [search, setSearch] = useState('')
  const onClose = props.onClose

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && sectionRef.current?.contains(event.target) === true) return
      onClose()
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [onClose])
  const servers = snapshot.data?.servers ?? []
  const enabledCount = servers.filter(server => server.enabled).length
  const matchingServers = servers.filter(server => matchesServerSearch(server, search))
  const emptyText = servers.length === 0 ? t('empty') : matchingServers.length === 0 ? t('quickPanelNoResults') : null

  return (
    <section
      aria-label={t('title')}
      className="dshx-root dshx:absolute dshx:bottom-[calc(100%+8px)] dshx:left-0 dshx:z-40 dshx:flex dshx:max-h-[min(70vh,36rem)] dshx:w-[min(420px,calc(100vw-24px))] dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:bg-popover dshx:text-popover-foreground dshx:shadow-lg"
      onKeyDown={event => {
        if (event.key === 'Escape') props.onClose()
      }}
      ref={sectionRef}
      role="dialog"
    >
      <header className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-b dshx:px-4 dshx:py-2.5">
        <div className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2">
          <h2 className="dshx:shrink-0 dshx:text-sm dshx:font-semibold">{t('title')}</h2>
          {snapshot.data ? (
            <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
              {enabledCount} {t('enabledGlobally')}
            </span>
          ) : null}
        </div>
        <Button aria-label={t('close')} onClick={props.onClose} size="icon-sm" variant="ghost">
          <XIcon className="dshx:size-4" />
        </Button>
      </header>
      <div className="dshx:border-b dshx:p-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon className="dshx:size-3.5" />
          </InputGroupAddon>
          <InputGroupInput aria-label={t('quickPanelSearch')} onChange={event => setSearch(event.currentTarget.value)} placeholder={t('quickPanelSearch')} value={search} />
        </InputGroup>
      </div>
      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
        {snapshot.isError || actions.failed ? (
          <Alert className="dshx:mx-3 dshx:mt-2 dshx:w-auto" variant="destructive">
            <AlertDescription>{t('error')}</AlertDescription>
          </Alert>
        ) : null}
        <SignInNotice actions={actions} className="dshx:mx-3 dshx:mt-2 dshx:w-auto" t={t} />
        {snapshot.isPending ? (
          <div className="dshx:flex dshx:justify-center dshx:py-6 dshx:text-muted-foreground">
            <Spinner />
          </div>
        ) : emptyText ? (
          <p className="dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="dshx:divide-y dshx:px-3">
            {matchingServers.map(server => {
              const processText = localProcessText(server, t)
              return (
                <li className="dshx:flex dshx:items-center dshx:gap-3 dshx:py-2.5" key={server.id}>
                  <span className="dshx:flex dshx:size-8 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:bg-muted dshx:text-muted-foreground">
                    {server.transport === 'stdio' ? <SquareTerminalIcon className="dshx:size-4" /> : <GlobeIcon className="dshx:size-4" />}
                  </span>
                  <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                    <p className="dshx:truncate dshx:text-sm dshx:font-medium">{server.name}</p>
                    <p className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
                      <span aria-hidden className={cn('dshx:size-1.5 dshx:shrink-0 dshx:rounded-full', lifecycleDotClassName(server))} />
                      <span className="dshx:truncate">
                        {server.oauth === 'needs-sign-in' ? t('signInRequired') : `${lifecycleText(server, t)} · ${server.registeredToolCount} ${t('registeredTools')}`}
                      </span>
                    </p>
                    {processText ? <p className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{processText}</p> : null}
                  </div>
                  {server.oauth === 'needs-sign-in' ? (
                    <Button disabled={actions.isPending || !server.enabled} onClick={() => actions.signIn(server)} size="sm" variant="outline">
                      {t('signIn')}
                    </Button>
                  ) : (
                    <Button
                      disabled={actions.isPending || isConnectionToggleBlocked(server)}
                      onClick={() => actions.toggleConnection(server)}
                      size="sm"
                      variant={isClientActive(server) ? 'ghost' : 'outline'}
                    >
                      {isClientActive(server) ? t('disconnect') : t('connect')}
                    </Button>
                  )}
                  <Switch
                    aria-label={`${server.enabled ? t('disable') : t('enable')} ${server.name}`}
                    checked={server.enabled}
                    disabled={actions.isPending}
                    onCheckedChange={() => actions.toggleEnabled(server)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <footer className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:border-t dshx:p-2.5">
        <Button aria-label={t('refresh')} disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()} size="icon-sm" variant="ghost">
          {snapshot.isFetching ? <Spinner /> : <RefreshCwIcon className="dshx:size-4" />}
        </Button>
        <div className="dshx:flex dshx:items-center dshx:gap-1">
          <Button onClick={props.onManage} size="sm" variant="ghost">
            <SettingsIcon className="dshx:size-3.5" />
            {t('manageShort')}
          </Button>
          <Button onClick={props.onBrowse} size="sm">
            <PlusIcon className="dshx:size-3.5" />
            {t('addMcp')}
          </Button>
        </div>
      </footer>
    </section>
  )
}
