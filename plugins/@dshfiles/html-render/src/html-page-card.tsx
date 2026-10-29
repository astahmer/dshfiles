import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CheckIcon, CopyIcon, ExternalLinkIcon, FileCodeIcon, LoaderCircleIcon, Maximize2Icon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { HtmlPageModel, type HtmlPage } from './html-page.js'
import { SandboxedDocument, type ColorScheme } from './sandboxed-document.js'

const DARK_THEME_ATTRIBUTE = 'data-ds-dark-theme'
const STANDALONE_URL_LIFETIME_MS = 60_000
const COPIED_FEEDBACK_MS = 1_500

const subscribeHostScheme = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { attributes: true, attributeFilter: [DARK_THEME_ATTRIBUTE] })
  return () => observer.disconnect()
}
const readHostScheme = (): ColorScheme => (document.body.hasAttribute(DARK_THEME_ATTRIBUTE) ? 'dark' : 'light')

const useHostColorScheme = (): ColorScheme => useSyncExternalStore(subscribeHostScheme, readHostScheme, () => 'light')

/** Radix focuses the first focusable child, the frame, whose keystrokes (Escape) never reach the dialog. */
const keepFocusOutsideFrame = (event: Event): void => {
  event.preventDefault()
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
}

const openStandalone = (page: string): void => {
  const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }))
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), STANDALONE_URL_LIFETIME_MS)
}

const IconAction = (props: { readonly label: string; readonly onClick: () => void; readonly children: ReactNode }): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button aria-label={props.label} onClick={props.onClick} size="icon-xs" type="button" variant="ghost">
        {props.children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{props.label}</TooltipContent>
  </Tooltip>
)

const SandboxedFrame = (props: { readonly title: string; readonly document: string; readonly className?: string }): JSX.Element => (
  <iframe
    className={cn('dshx:block dshx:size-full dshx:border-0', props.className)}
    data-html-render-frame=""
    sandbox="allow-scripts"
    srcDoc={props.document}
    title={props.title}
  />
)

/** One published page: a resizable sandboxed frame with copy, new-tab and full-screen actions. */
export const HtmlPageCard = (props: { readonly page: HtmlPage }): JSX.Element => {
  const hostScheme = useHostColorScheme()
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const theme = useMemo(
    () =>
      SandboxedDocument.resolveTheme({ theme: props.page.theme, hostScheme, readHostToken: name => getComputedStyle(document.body).getPropertyValue(name) }),
    [props.page.theme, hostScheme],
  )
  const frameDocument = useMemo(() => SandboxedDocument.build({ html: props.page.html, scheme: theme.scheme, tokens: theme.tokens }), [props.page.html, theme])
  const bytes = useMemo(() => HtmlPageModel.byteLength(props.page.html), [props.page.html])

  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = (): void => {
    void writeClipboard(props.page.html).then(() => setCopied(true))
  }
  const openInNewTab = (): void =>
    openStandalone(SandboxedDocument.standalone({ title: props.page.title, document: frameDocument, scheme: theme.scheme, background: theme.tokens.bg }))

  return (
    <TooltipProvider delayDuration={500}>
      <section
        aria-label={props.page.title}
        className="dshx-root dshx:@container dshx:my-1 dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card"
        data-html-render-card=""
      >
        <header className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:py-1 dshx:pr-1 dshx:pl-3">
          <FileCodeIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium dshx:text-foreground">{props.page.title}</span>
          <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums dshx:@max-pane-narrow:hidden">
            {HtmlPageModel.formatBytes(bytes)}
          </span>
          <IconAction label={copied ? 'Copied' : 'Copy HTML'} onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </IconAction>
          <IconAction label="Open in new tab" onClick={openInNewTab}>
            <ExternalLinkIcon />
          </IconAction>
          <IconAction label="Expand" onClick={() => setExpanded(true)}>
            <Maximize2Icon />
          </IconAction>
        </header>
        <div
          className="dshx:max-h-[85vh] dshx:min-h-20 dshx:resize-y dshx:overflow-hidden dshx:bg-background"
          data-html-render-viewport=""
          style={{ height: props.page.height }}
        >
          {!expanded && <SandboxedFrame document={frameDocument} title={props.page.title} />}
        </div>
      </section>
      <Dialog onOpenChange={setExpanded} open={expanded}>
        <DialogContent
          onOpenAutoFocus={keepFocusOutsideFrame}
          className="dshx-root dshx:top-4 dshx:left-4 dshx:flex dshx:h-[calc(100dvh-2rem)] dshx:w-[calc(100vw-2rem)] dshx:max-w-none dshx:translate-x-0 dshx:translate-y-0 dshx:flex-col dshx:gap-2 dshx:p-3 dshx:sm:max-w-none"
        >
          <DialogTitle className="dshx:truncate dshx:pr-8 dshx:text-sm">{props.page.title}</DialogTitle>
          <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-border">
            <SandboxedFrame document={frameDocument} title={props.page.title} />
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}

/** The call before its page settles: still streaming arguments or running. */
export const HtmlPagePending = (props: { readonly title: string | undefined }): JSX.Element => (
  <div className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:py-1 dshx:text-sm dshx:text-muted-foreground" data-html-render-pending="">
    <LoaderCircleIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:animate-spin" />
    <span className="dshx:min-w-0 dshx:truncate">{props.title === undefined ? 'Rendering HTML page…' : `Rendering ${props.title}…`}</span>
  </div>
)

/** A refused call: the tool's own error, which already names the fix (size, empty field). */
export const HtmlPageFailed = (props: { readonly title: string | undefined; readonly reason: string }): JSX.Element => (
  <div className="dshx-root dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2 dshx:py-1 dshx:text-sm" data-html-render-failed="" role="alert">
    <TriangleAlertIcon aria-hidden className="dshx:mt-0.5 dshx:size-3.5 dshx:shrink-0 dshx:text-destructive" />
    <span className="dshx:min-w-0">
      <span className="dshx:font-medium dshx:text-foreground">{props.title === undefined ? 'HTML page not published' : `${props.title} not published`}</span>
      <span className="dshx:block dshx:text-muted-foreground">{props.reason}</span>
    </span>
  </div>
)
