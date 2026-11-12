/** Shell launch menu owned by the terminal provider's guide entry. */
import { useEffect, useState, type ReactNode } from 'react'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginArtworkTerminal, ShortcutKeys, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button as KitButton } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ChevronDownIcon } from '@dshfiles/plugin-ui/icons'
import type { TerminalLaunchShells } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './locales.ts'
import css from './TerminalGuide.module.css'

/** Provider-owned discovery and browser preference writes. */
export interface TerminalGuideInjected {
  readonly hooks: { readonly shortcuts: HostObservable<readonly ShortcutCatalogEntry[]> }
  /** @param signal - open menu lifetime. @returns current Host choices and browser preference. */
  readonly loadShells: (signal: AbortSignal) => Promise<TerminalLaunchShells>
  /** @param path - Host-discovered shell selected for the next terminal. */
  readonly selectShell: (path: string) => void
}

/** Session guide owner props, framework hooks and terminal actions. */
export type TerminalGuideProps = PropsRuntime<'sidebar.right.tab.guide.entry'> & PropsLocale<'sidebarTerminal'> & InjectFace<TerminalGuideInjected>

type MenuState = { phase: 'loading' } | { phase: 'ready'; choices: TerminalLaunchShells } | { phase: 'failed'; message: string }

/**
 * Open the remembered shell from the card or choose another shell from its menu.
 * The card displays its effective shortcut; the shell menu sits beside the title.
 * @param props - guide copy, enclosing tab actions and cancellable discovery.
 * @returns separate launch and menu buttons within one guide card.
 */
export function TerminalGuide({
  title, description, kind, useTabInfo, loadShells, selectShell, t, useShortcuts,
}: TerminalGuideProps): ReactNode {
  const shortcut = useShortcuts(entries => entries.find(entry => entry.id === 'terminal.new'))
  const { tab } = useTabInfo()
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<MenuState>({ phase: 'loading' })
  useEffect(() => {
    if (!open) return
    const lifetime = new AbortController()
    void loadShells(lifetime.signal).then((choices) => {
      if (!lifetime.signal.aborted) setState({ phase: 'ready', choices })
    }, (error: unknown) => {
      if (!lifetime.signal.aborted) setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { lifetime.abort() }
  }, [open, attempt, loadShells])
  // dshfiles: the shell menu is the kit dropdown (a bottom sheet on a phone), with lucide icons and 44px rows on touch.
  const launch = (path: string): void => {
    selectShell(path)
    setOpen(false)
    tab.actions.openTab('terminal', { replaceTab: true, params: { shellPath: path } })
  }
  const menu = state.phase === 'ready'
    ? state.choices.shells.length === 0
      ? <DropdownMenuItem disabled>{t('shellEmpty')}</DropdownMenuItem>
      : <DropdownMenuRadioGroup value={state.choices.selectedShell ?? ''} onValueChange={launch}>
        {state.choices.shells.map(shell => <DropdownMenuRadioItem key={shell.path} value={shell.path}>{shell.name}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    : state.phase === 'loading'
      ? <DropdownMenuItem disabled>{t('shellLoading')}</DropdownMenuItem>
      : <>
        <DropdownMenuItem disabled>{t('failed', { message: state.message })}</DropdownMenuItem>
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setState({ phase: 'loading' }); setAttempt(value => value + 1) }}>{t('retry')}</DropdownMenuItem>
      </>
  return <div className={css.entry} data-sidebar-right-guide-entry={kind}>
    <Button variant="ghost" className={css.main} aria-label={description === undefined ? title : `${title} ${description}`} aria-keyshortcuts={shortcut?.aria}
      onClick={() => { tab.actions.openTab('terminal', { replaceTab: true }) }} />
    <span className={css.icon} aria-hidden="true"><PluginArtworkTerminal size={description === undefined ? 22 : 26} /></span>
    <span className={css.text}>
      <span className={css.titleRow}>
        <span className={css.title} aria-hidden="true">{title}</span>
        <span className={`dshx-root ${css.menu}`}>
          <DropdownMenu open={open} onOpenChange={(next) => { if (next) setState({ phase: 'loading' }); setOpen(next) }}>
            <DropdownMenuTrigger asChild>
              <KitButton variant="ghost" size="icon-xs" className={css.trigger} aria-label={t('shell')}>
                <ChevronDownIcon aria-hidden />
              </KitButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dshx-root">{menu}</DropdownMenuContent>
          </DropdownMenu>
        </span>
      </span>
      {description !== undefined && <span className={css.description} aria-hidden="true">{description}</span>}
    </span>
    {shortcut !== undefined && shortcut.keys.length > 0 && <ShortcutKeys keys={shortcut.keys} className={css.shortcut} />}
  </div>
}
