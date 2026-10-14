import type { SessionWorkspacePathApplication } from '@deepseek-ai/dsh-api-session-controller/types'
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
import { useEffect, useState } from 'react'
import type { SettingsDocumentStore } from './native/document-action.js'
import type { ShellTranslate } from './native/locales.js'
import { useObservable } from './native/use-observable.js'

/** The Host desktop operations the menu needs, over the Session Remote's path opener (the native open-in service). */
export interface ConfigFileOpeners {
  readonly documentPath: () => Promise<DocumentLocation | null>
  readonly canOpenPaths: () => Promise<boolean>
  readonly applications: (path: string) => Promise<readonly SessionWorkspacePathApplication[] | null>
  readonly openWith: (path: string, applicationId: string) => Promise<boolean>
  readonly reveal: (path: string) => Promise<boolean>
  /** Hands the file to the in-app Editor; false when it is not loaded or has no thread to open it in. */
  readonly openInEditor: ((path: string) => boolean) | undefined
}

interface DocumentLocation {
  readonly path: string
  /** False until the native action first creates the document; only the path can be copied then. */
  readonly exists: boolean
}

type Feedback = { readonly kind: 'error'; readonly message: string } | { readonly kind: 'copied' } | null

const FEEDBACK_MS = 2_500

const isMac = (): boolean => /Mac/u.test(navigator.platform)

/**
 * "Open configuration file" as a split button, like the thread header's open-in control: the button keeps the native
 * action (the Host's text editor), and ▾ opens the file with any app the desktop associates with it, in the Editor
 * plugin, copies its path or reveals it in the file manager. Rendered only where the native action is: a loopback
 * page whose Host has a settings document.
 */
export const OpenConfigAction = (props: {
  readonly controller: SettingsDocumentStore
  readonly openers: ConfigFileOpeners
  readonly t: ShellTranslate
}): JSX.Element | null => {
  const state = useObservable(props.controller.store)
  const [location, setLocation] = useState<DocumentLocation | null>(null)
  const [desktop, setDesktop] = useState(false)
  const [apps, setApps] = useState<readonly SessionWorkspacePathApplication[] | null | undefined>(undefined)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const { t, openers } = props

  useEffect(() => {
    void props.controller.load()
  }, [props.controller])
  useEffect(() => {
    let live = true
    void openers.documentPath().then(next => live && setLocation(next))
    void openers.canOpenPaths().then(next => live && setDesktop(next))
    return () => {
      live = false
    }
  }, [openers])
  useEffect(() => {
    if (feedback === null) return
    const timeout = window.setTimeout(() => setFeedback(null), FEEDBACK_MS)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  if (state.status !== 'ready') return null
  const failed = (): void => setFeedback({ kind: 'error', message: t('config.failed') })
  const settle = (outcome: Promise<boolean>): void => {
    void outcome.then(ok => {
      if (!ok) failed()
    }, failed)
  }
  const path = location?.path ?? null
  const onDisk = location?.exists === true && desktop
  // The main button may have just created the document, so each menu opening reads its location again.
  const onMenu = (open: boolean): void => {
    if (!open) return
    void openers.documentPath().then(next => {
      setLocation(next)
      if (next !== null && next.exists && desktop && apps === undefined) void openers.applications(next.path).then(setApps, () => setApps(null))
    })
  }
  const errorText = feedback?.kind === 'error' ? feedback.message : state.error === null ? null : t('openDocument.error')

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
          disabled={state.opening}
          onClick={() => void props.controller.open()}
          title={path ?? undefined}
          type="button"
        >
          {t('openDocument')}
        </button>
        {path !== null && (
          <DropdownMenu onOpenChange={onMenu}>
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
                    <DropdownMenuItem key={app.id} onSelect={() => settle(openers.openWith(path, app.id))}>
                      {app.icon === null ? <CodeIcon /> : <img alt="" className="dshx:size-4" src={app.icon} />}
                      <span className="dshx:flex-1 dshx:truncate">{app.name.replace(/\.app$/u, '')}</span>
                      {app.default && <span className="dshx:text-[11px] dshx:text-muted-foreground">{t('config.default')}</span>}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {openers.openInEditor !== undefined && (
                <DropdownMenuItem
                  onSelect={() => {
                    if (openers.openInEditor?.(path) !== true) setFeedback({ kind: 'error', message: t('config.editorNeedsThread') })
                  }}
                >
                  <CodeIcon />
                  {t('config.editor')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void writeClipboard(path).then(ok => setFeedback(ok ? { kind: 'copied' } : { kind: 'error', message: t('config.failed') }))
                }}
              >
                <ClipboardCopyIcon />
                {t('config.copyPath')}
              </DropdownMenuItem>
              {onDisk && (
                <DropdownMenuItem onSelect={() => settle(openers.reveal(path))}>
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
