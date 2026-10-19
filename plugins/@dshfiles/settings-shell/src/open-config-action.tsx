import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ChevronDownIcon, ClipboardCopyIcon, CodeIcon, FolderOpenIcon, LoaderIcon } from '@dshfiles/plugin-ui/icons'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import type { ShellTranslate } from './native/locales.js'
import { useObservable } from './native/use-observable.js'
import { openConfigMachine, type ConfigFileOpeners, type SettingsDocumentController } from './open-config-machine.js'

export type { ConfigFileOpeners } from './open-config-machine.js'

const isMac = (): boolean => /Mac/u.test(navigator.platform)

/**
 * Existing documents open through the Session path opener's configured default; the native Host action remains the
 * fallback when no document exists or desktop path opening is unavailable. The menu also offers associated apps, the
 * Editor plugin, copying the path, and revealing it in the file manager. Rendered only on a loopback page whose Host
 * has a settings document.
 */
export const OpenConfigAction = (props: {
  readonly controller: SettingsDocumentController
  readonly openers: ConfigFileOpeners
  readonly t: ShellTranslate
}): JSX.Element | null => {
  const [snapshot, send] = useMachine(openConfigMachine, {
    input: { controller: props.controller, openers: props.openers, copyPath: writeClipboard },
  })
  const state = useObservable(props.controller.store)
  const { t } = props
  const { apps, desktop, feedback, location, openers } = snapshot.context

  if (state.status !== 'ready') return null
  const path = location?.path ?? null
  const onDisk = location?.exists === true && desktop === true
  const busy = snapshot.matches({ active: 'primaryLoading' }) || snapshot.matches({ active: 'menuLoading' }) || snapshot.matches({ active: 'menuAction' })
  const errorText = feedback?.kind === 'error' ? t(feedback.key) : state.error === null ? null : t('openDocument.error')

  return (
    <div className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
      {errorText !== null && (
        <span className="dshx:max-w-[200px] dshx:truncate dshx:text-[12px] dshx:leading-[18px] dshx:text-destructive" role="alert" title={errorText}>
          {errorText}
        </span>
      )}
      {feedback?.kind === 'copied' && (
        <span className="dshx:text-[12px] dshx:text-muted-foreground" role="status">
          {t('config.copied')}
        </span>
      )}
      <div className="dshx:inline-flex dshx:h-7 dshx:items-stretch dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:shadow-xs">
        <button
          className="dshx:inline-flex dshx:cursor-pointer dshx:items-center dshx:border-none dshx:bg-transparent dshx:px-2.5 dshx:text-[12px] dshx:font-medium dshx:whitespace-nowrap dshx:text-foreground dshx:hover:bg-accent dshx:disabled:cursor-default dshx:disabled:opacity-60"
          disabled={state.opening || busy}
          onClick={() => send({ type: 'primary' })}
          title={path ?? undefined}
          type="button"
        >
          {t('openDocument')}
        </button>
        {path !== null && (
          <DropdownMenu onOpenChange={open => open && send({ type: 'menu.open' })}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t('config.more')}
                className="dshx:inline-flex dshx:w-6 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:border-0 dshx:border-l dshx:border-solid dshx:border-border dshx:bg-transparent dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
                type="button"
              >
                <ChevronDownIcon className="dshx:size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dshx:min-w-56">
              {onDisk && (
                <>
                  <DropdownMenuLabel className="dshx:text-xs dshx:text-muted-foreground">{t('config.openWith')}</DropdownMenuLabel>
                  {apps === undefined && (
                    <DropdownMenuItem disabled>
                      <LoaderIcon className="dshx:animate-spin" />
                      {t('config.loadingApps')}
                    </DropdownMenuItem>
                  )}
                  {apps !== undefined && (apps === null || apps.length === 0) && <DropdownMenuItem disabled>{t('config.noApps')}</DropdownMenuItem>}
                  {apps?.map(app => (
                    <DropdownMenuItem key={app.id} onSelect={() => send({ type: 'open.with', applicationId: app.id })}>
                      {app.icon === null ? <CodeIcon /> : <img alt="" className="dshx:size-4" src={app.icon} />}
                      <span className="dshx:flex-1 dshx:truncate">{app.name.replace(/\.app$/u, '')}</span>
                      {app.default && <span className="dshx:text-[11px] dshx:text-muted-foreground">{t('config.default')}</span>}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {openers.openInEditor !== undefined && (
                <DropdownMenuItem onSelect={() => send({ type: 'open.editor' })}>
                  <CodeIcon />
                  {t('config.editor')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => send({ type: 'copy.path' })}>
                <ClipboardCopyIcon />
                {t('config.copyPath')}
              </DropdownMenuItem>
              {onDisk && (
                <DropdownMenuItem onSelect={() => send({ type: 'reveal' })}>
                  <FolderOpenIcon />
                  {isMac() ? t('config.reveal') : t('config.showInFolder')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
