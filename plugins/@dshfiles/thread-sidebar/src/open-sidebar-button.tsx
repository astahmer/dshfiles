import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { PanelLeftOpenIcon } from '@dshfiles/plugin-ui/icons'

/**
 * The chord frame-layout binds to the left sidebar toggle: ⌘B in the desktop app, ⌥⌘B in a browser (where ⌘B is the
 * browser's own), with Ctrl for Cmd off a Mac.
 */
const sidebarChord = (): string => {
  const mac = /Mac|iPhone|iPad/u.test(globalThis.navigator?.userAgent ?? '')
  const primary = mac ? 'Meta' : 'Control'
  // The desktop app marks <html data-platform>; a browser leaves it unset.
  return globalThis.document?.documentElement.dataset.platform === undefined ? `${primary}+Alt+B` : `${primary}+B`
}

/**
 * The way back to the sidebar once the frame hides it (below 1024 px it becomes a drawer, and nothing on screen
 * opened it): one 28 px icon button in frame-layout's `shell.leading` seat, which the frame mounts only while the
 * sidebar is hidden, with a 44 px hit area on touch.
 */
export const OpenSidebarButton = (props: { readonly label: string; readonly onOpen: () => void }): JSX.Element => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          // The phone shell navigates with its top bar and bottom tabs; the opener is for a narrow desktop window.
          className="dshx-root dshx-hit-44 dshx:phone:hidden"
          aria-label={props.label}
          aria-keyshortcuts={sidebarChord()}
          data-open-sidebar=""
          onClick={props.onOpen}
        >
          <PanelLeftOpenIcon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{props.label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)
