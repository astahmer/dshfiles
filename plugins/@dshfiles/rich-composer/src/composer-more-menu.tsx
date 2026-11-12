import { useRegistry } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EllipsisIcon } from '@dshfiles/plugin-ui/icons'
import { Fragment, useRef, useState, useSyncExternalStore } from 'react'
import { ComposerMoreItems, type ComposerBarPlacement, type ComposerMoreItem } from './composer-more.ts'

/** Rows in order, split where the group changes, so each plugin's verbs sit together between separators. */
const groupRows = (items: readonly ComposerMoreItem[]): readonly (readonly ComposerMoreItem[])[] => {
  const sorted = [...items].sort((left, right) => (left.order ?? 100) - (right.order ?? 100))
  const groups: ComposerMoreItem[][] = []
  for (const item of sorted) {
    const last = groups.at(-1)
    if (last !== undefined && (last[0]?.group ?? '') === (item.group ?? '')) last.push(item)
    else groups.push([item])
  }
  return groups
}

/**
 * The composer bar's one More (⋯) button (polish pass b:r4et): undo, rewind, redo and saved prompts as labelled rows
 * with their keys, instead of four icons always in the bar. On a phone the kit menu presents as a bottom sheet. Hidden
 * while the user pins those controls back into the bar, and while no plugin adds a row.
 */
export const ComposerMoreMenu = (props: { readonly sessionId: string; readonly placement: ComposerBarPlacement }): JSX.Element | null => {
  const items = useRegistry(ComposerMoreItems)
  const pinned = useSyncExternalStore(props.placement.subscribe, props.placement.pinned, props.placement.pinned)
  const [open, setOpen] = useState(false)
  // The row picked in this menu, run once the menu has unmounted (see onCloseAutoFocus).
  const picked = useRef<ComposerMoreItem | null>(null)
  if (pinned || items.length === 0) return null
  const label = 'More composer actions'
  return (
    <TooltipProvider delayDuration={500}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={label}
                className="dshx-root dshx:text-muted-foreground dshx:hover:text-foreground dshx:data-[state=open]:bg-accent dshx:data-[state=open]:text-foreground"
                data-composer-more=""
                // Keep the editor's caret and selection while the menu opens.
                onMouseDown={event => event.preventDefault()}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          {open ? null : <TooltipContent side="top">More: undo, history, saved prompts</TooltipContent>}
        </Tooltip>
        <DropdownMenuContent
          align="end"
          side="top"
          className="dshx-root dshx:min-w-60"
          aria-label={label}
          // A row opens another plugin's popover or dialog: handing focus back to ⋯ would dismiss it at once. Radix fires
          // this when the content unmounts, after its exit animation. Only then does the picked row run: while the menu
          // still animates out its focus trap pulls focus back from a freshly opened popover, which then closes itself
          // as "focus outside" (b:2cep: Saved prompts and Prompt history vanished right after opening).
          onCloseAutoFocus={event => {
            event.preventDefault()
            const item = picked.current
            picked.current = null
            if (item !== null) window.setTimeout(() => item.select(props.sessionId), 0)
          }}
        >
          <DropdownMenuLabel>Composer</DropdownMenuLabel>
          {groupRows(items).map((group, index) => (
            <Fragment key={group[0]?.id ?? String(index)}>
              {index === 0 ? null : <DropdownMenuSeparator />}
              {group.map(item => (
                <DropdownMenuItem
                  data-composer-more-item={item.id}
                  disabled={item.available?.(props.sessionId) === false}
                  key={item.id}
                  {...(item.keys === undefined || item.keys.length === 0 ? {} : { keys: item.keys })}
                  // Runs after the menu has unmounted, so the plugin's own popover or dialog opens on a settled page.
                  onSelect={() => {
                    picked.current = item
                  }}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}
