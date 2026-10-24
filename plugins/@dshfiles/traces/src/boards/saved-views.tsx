import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { BookmarkIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import { z } from 'zod'
import type { TracesAlertsTranslate } from '../alerts/alerts-locale.js'
import { logsViewSchema, storedLogsView } from '../log-list.js'
import { storedTracesView, tracesViewSchema } from '../view-state.js'
import { BUILTIN_BOARDS } from './board-definitions.js'
import { boardCopyOf, storedBoardId } from './boards-view.js'

const MAX_SAVED_VIEWS = 30

const savedViewSchema = z
  .object({
    id: z.string().max(64),
    name: z.string().trim().min(1).max(80),
    savedAt: z.number(),
    traces: tracesViewSchema,
    logs: logsViewSchema,
    board: z.string().max(64).nullable(),
  })
  .strip()
type SavedView = z.infer<typeof savedViewSchema>

/**
 * Named snapshots of the panel's own view state (tab, trace filters, log filters, window, open board), like a bookmark
 * of a URL. They are this browser's presentation state, not Host data, so they live in localStorage and have no agent
 * tool; an agent reproduces a view with the same traces_search / traces_search_logs / traces_breakdown filters.
 */
const storedSavedViews = createStoredValue({ key: 'dshfiles.traces.saved-views.v1', schema: z.array(savedViewSchema).max(MAX_SAVED_VIEWS), fallback: [] })

const applyView = (view: SavedView): void => {
  storedTracesView.set(view.traces)
  storedLogsView.set(view.logs)
  if (view.board !== null) storedBoardId.set(view.board)
}

const saveCurrentView = (name: string): void => {
  const traces = storedTracesView.get()
  const view: SavedView = {
    id: `view-${Date.now().toString(36)}`,
    name: name.trim(),
    savedAt: Date.now(),
    traces,
    logs: storedLogsView.get(),
    board: traces.tab === 'boards' ? storedBoardId.get() : null,
  }
  storedSavedViews.set([view, ...storedSavedViews.get().filter(existing => existing.name !== view.name)].slice(0, MAX_SAVED_VIEWS))
}

/** The panel header's Views menu: built-in boards one click away, the user's saved views, and saving the current one. */
export const SavedViewsMenu = (props: { readonly t: TracesAlertsTranslate }): JSX.Element => {
  const t = props.t
  const saved = storedSavedViews.useValue()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={t('views')}>
            <BookmarkIcon />
            <span className="dshx:@max-pane-compact:sr-only">{t('views')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dshx-root dshx:w-64">
          <DropdownMenuLabel>{t('tabBoards')}</DropdownMenuLabel>
          {BUILTIN_BOARDS.map(board => (
            <DropdownMenuItem
              key={board.id}
              onSelect={() => {
                storedBoardId.set(board.id)
                storedTracesView.set({ ...storedTracesView.get(), tab: 'boards' })
              }}
            >
              {t(boardCopyOf(board.id).title)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('savedViews')}</DropdownMenuLabel>
          {saved.length === 0 ? (
            <DropdownMenuItem disabled>{t('noSavedViews')}</DropdownMenuItem>
          ) : (
            saved.map(view => (
              <DropdownMenuItem key={view.id} onSelect={() => applyView(view)}>
                <span className="dshx:min-w-0 dshx:truncate">{view.name}</span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setName('')
              setNaming(true)
            }}
          >
            {t('saveView')}
          </DropdownMenuItem>
          {saved.length === 0 ? null : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t('deleteView')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="dshx-root">
                {saved.map(view => (
                  <DropdownMenuItem
                    key={view.id}
                    variant="destructive"
                    onSelect={() => storedSavedViews.set(saved.filter(existing => existing.id !== view.id))}
                  >
                    <span className="dshx:min-w-0 dshx:truncate">{view.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="dshx-root dshx:sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('saveViewTitle')}</DialogTitle>
            <DialogDescription>{t('saveViewDescription')}</DialogDescription>
          </DialogHeader>
          <form
            className="dshx:flex dshx:flex-col dshx:gap-3"
            onSubmit={event => {
              event.preventDefault()
              if (name.trim() === '') return
              saveCurrentView(name)
              setNaming(false)
            }}
          >
            <Label htmlFor="dshfiles-traces-view-name">{t('viewName')}</Label>
            <Input id="dshfiles-traces-view-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} autoFocus />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNaming(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={name.trim() === ''}>
                {t('saveViewConfirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
