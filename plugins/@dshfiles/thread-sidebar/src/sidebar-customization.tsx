import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { SettingsIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface SidebarSettingsButtonProps {
  readonly label: string
  readonly onClick: () => void
  readonly expanded?: boolean
}

export const SidebarSettingsButton = ({ label, onClick, expanded }: SidebarSettingsButtonProps): JSX.Element => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="dshx:shrink-0 dshx:text-muted-foreground"
          aria-label={label}
          aria-expanded={expanded}
          onClick={onClick}
        >
          <SettingsIcon className="dshx:size-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)

/** Workbench supplies the trigger inside Threads; only the standalone shell keeps this fallback. */
export const SidebarCustomizationFallback = ({
  contentOverridden,
  ...props
}: SidebarSettingsButtonProps & { readonly contentOverridden: boolean }): JSX.Element | null =>
  contentOverridden ? null : <SidebarSettingsButton {...props} />

/** Only the DOM seat moves. The editor, React context and preference writes remain owned by SidebarRoot. */
export const SidebarCustomizationSeat = ({
  target,
  label,
  children,
}: {
  readonly target: HTMLElement | null
  readonly label: string
  readonly children: ReactNode
}): JSX.Element => {
  const editor = (
    <section
      className={cn(
        'dshx:absolute dshx:z-20 dshx:flex dshx:flex-col dshx:gap-4 dshx:overflow-auto dshx:rounded-lg dshx:border dshx:bg-card dshx:p-2 dshx:shadow-lg',
        target === null ? 'dshx:inset-x-2 dshx:top-12 dshx:bottom-14' : 'dshx:inset-0',
      )}
      aria-label={label}
    >
      {children}
    </section>
  )
  return target === null ? editor : createPortal(editor, target)
}
