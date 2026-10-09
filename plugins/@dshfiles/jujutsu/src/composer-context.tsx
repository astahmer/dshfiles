import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { ChevronDownIcon, FileCodeIcon, FileDiffIcon, FolderIcon, GitBranchIcon, GitCommitHorizontalIcon, LayersIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { z } from 'zod'
import { useAutoRefresh } from './auto-refresh.js'
import { composerContextApi, type ComposerBase, type ComposerRepository } from './composer-context-api.js'
import { composerBaseFromSetting, composerBaseSetting } from './composer-context-core.js'
import { FullDiffDialog } from './full-diff-dialog.js'
import { decodePreferences } from './preferences.js'
import { jujutsuSettings } from './settings.js'

export interface ComposerJujutsuServices {
  readonly sessions: ISessions
  readonly openJujutsu: () => void
}

export interface ComposerSlotProps {
  readonly sessionId: SessionSummary['id']
  readonly jujutsu: ComposerJujutsuServices
}

// Inline instead of client.css so the plugin sheet stays byte-identical to the shared plugin-ui sheet; same
// geometry as the shipped queue dock so the bar lines up with the composer card.
const ABOVE_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width:
    'calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))',
  maxWidth: 'calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))',
  margin: '0 auto',
  flex: 'none',
}

const noStoredBases: Readonly<Record<string, string>> = {}
const storedBases = createStoredValue({ key: 'dshfiles.jujutsu.composer-base.v1', schema: z.record(z.string(), z.string().max(256)), fallback: noStoredBases })

const noCwd = (): null => null

const useSessionCwd = (sessions: ISessions, sessionId: SessionSummary['id']): string | null => {
  const subscribe = useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions])
  const read = useCallback(() => sessions.list.getSnapshot().byId[sessionId]?.cwd ?? null, [sessions, sessionId])
  const cwd = useSyncExternalStore(subscribe, read, noCwd)
  return cwd === null || cwd.length === 0 ? null : cwd
}

const composerKeys = {
  context: (cwd: string, base: string) => ['jujutsu', 'composer', cwd, base, 'context'] as const,
  diff: (cwd: string, base: string) => ['jujutsu', 'composer', cwd, base, 'diff'] as const,
}

/** Settings, the Session cwd and the chosen base, then the shared context query both composer slots read. */
const useComposerContext = (props: ComposerSlotProps, surface: 'composerBar' | 'composerChips') => {
  const settings = useSettings(jujutsuSettings)
  // Keys added after the Host started are absent until a DSH restart; field-wise defaults keep the slots on.
  const preferences = decodePreferences(settings.value ?? {})
  const cwd = useSessionCwd(props.jujutsu.sessions, props.sessionId)
  const bases = storedBases.useValue()
  const base: ComposerBase = composerBaseFromSetting((cwd === null ? undefined : bases[cwd]) ?? preferences.composerBarBase)
  const baseKey = composerBaseSetting(base)
  const api = useApi(composerContextApi)
  const enabled = preferences[surface] && cwd !== null
  const refetch = useRef<() => void>(() => undefined)
  const refresh = useAutoRefresh({ preferences, paused: false, onBecameVisible: () => refetch.current() })
  const query = useQuery({
    queryKey: composerKeys.context(cwd ?? '', baseKey),
    queryFn: ({ signal }) => api.context({ cwd: cwd ?? '', base }, { signal }),
    enabled,
    retry: false,
    ...refresh.queryOptions,
  })
  refetch.current = () => void query.refetch()
  const chooseBase = (next: ComposerBase): void => {
    if (cwd !== null) storedBases.set({ ...bases, [cwd]: composerBaseSetting(next) })
  }
  return {
    ref: refresh.ref,
    cwd,
    base,
    baseKey,
    chooseBase,
    repository: enabled && query.isSuccess ? query.data.repository : null,
  }
}

const basename = (path: string): string => path.replace(/\/+$/, '').split('/').at(-1) ?? path

const STATUS_CLASS: Record<string, string> = {
  A: 'dshx:text-success',
  D: 'dshx:text-destructive',
  R: 'dshx:text-warning',
  C: 'dshx:text-warning',
  M: 'dshx:text-muted-foreground',
}

const BasePicker = (props: { readonly repository: ComposerRepository; readonly base: ComposerBase; readonly onChoose: (base: ComposerBase) => void }) => {
  const [filter, setFilter] = useState('')
  const bookmarks = props.repository.localBookmarks.filter(name => name.toLowerCase().includes(filter.toLowerCase())).slice(0, 40)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="dshx:ml-auto dshx:max-w-[45%] dshx:text-muted-foreground" size="xs" type="button" variant="ghost">
          <span>Base</span>
          <span className={cn('dshx:truncate dshx:font-mono! dshx:text-foreground', !props.repository.base.found && 'dshx:text-warning')}>
            {props.repository.base.label}
          </span>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx:max-h-80 dshx:w-64 dshx:overflow-y-auto">
        <DropdownMenuLabel className="dshx:text-xs">Compare the working copy against</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={value => props.onChoose(composerBaseFromSetting(value))}
          value={composerBaseSetting(props.base)}
        >
          <DropdownMenuRadioItem value="parent">Parent (@-)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="trunk">Trunk (trunk())</DropdownMenuRadioItem>
          {props.repository.localBookmarks.length > 0 && <DropdownMenuSeparator />}
          {props.repository.localBookmarks.length > 8 && (
            <input
              aria-label="Filter bookmarks"
              className="dshx:mx-1 dshx:mb-1 dshx:w-[calc(100%-0.5rem)] dshx:rounded-sm dshx:border dshx:bg-background dshx:px-2 dshx:py-1 dshx:font-mono! dshx:text-xs"
              onChange={event => setFilter(event.target.value)}
              onKeyDown={event => event.stopPropagation()}
              placeholder="Filter bookmarks"
              value={filter}
            />
          )}
          {bookmarks.map(name => (
            <DropdownMenuRadioItem className="dshx:font-mono! dshx:text-xs" key={name} value={name}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "Uncommitted · 5 files, +116 −3 ▾" above the composer, with the changed files and a base picker. */
export const ComposerChangesBar = (props: ComposerSlotProps): JSX.Element | null => {
  const context = useComposerContext(props, 'composerBar')
  const [expanded, setExpanded] = useState(false)
  const [fullDiffPath, setFullDiffPath] = useState<string | null | undefined>(undefined)
  const api = useApi(composerContextApi)
  const repository = context.repository
  const diffQuery = useQuery({
    queryKey: composerKeys.diff(context.cwd ?? '', context.baseKey),
    queryFn: ({ signal }) => api.diff({ cwd: context.cwd ?? '', base: context.base }, { signal }),
    enabled: repository !== null && (expanded || fullDiffPath !== undefined),
    retry: false,
  })
  const countsByPath = useMemo(() => new Map(diffQuery.data?.files.map(file => [file.path, file]) ?? []), [diffQuery.data])
  if (repository === null) return null

  const fileCount = repository.totals?.files ?? repository.files.length
  const heading = context.base.kind === 'parent' ? 'Uncommitted' : 'Since ' + repository.base.label
  const openFile = (path: string): void => {
    window.dispatchEvent(new CustomEvent('dshfiles:open-file', { detail: { path, cwd: repository.root }, cancelable: true }))
  }

  return (
    <div className="dshx-root dshx:mb-1.5 dshx:rounded-lg dshx:border dshx:bg-background/90 dshx:text-xs" ref={context.ref} style={ABOVE_STYLE}>
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-1 dshx:py-0.5">
        <Button
          aria-expanded={expanded}
          className="dshx:min-w-0 dshx:justify-start dshx:text-muted-foreground"
          disabled={fileCount === 0}
          onClick={() => setExpanded(open => !open)}
          size="xs"
          type="button"
          variant="ghost"
        >
          <span className="dshx:font-medium dshx:text-foreground">{heading}</span>
          <span>·</span>
          {fileCount === 0 ? (
            <span>no changes</span>
          ) : (
            <>
              <span>
                {fileCount} {fileCount === 1 ? 'file' : 'files'}
                {repository.totals !== null && ','}
              </span>
              {repository.totals !== null && (
                <span className="dshx:font-mono! dshx:tabular-nums">
                  <span className="dshx:text-success">+{repository.totals.additions}</span>{' '}
                  <span className="dshx:text-destructive">−{repository.totals.deletions}</span>
                </span>
              )}
              <ChevronDownIcon className={cn('dshx:transition-transform', expanded && 'dshx:rotate-180')} />
            </>
          )}
        </Button>
        <BasePicker
          base={context.base}
          onChoose={next => {
            context.chooseBase(next)
            setExpanded(false)
          }}
          repository={repository}
        />
      </div>
      {expanded && fileCount > 0 && (
        <ul className="dshx:max-h-56 dshx:overflow-y-auto dshx:border-t dshx:py-1">
          {repository.files.map(file => {
            const counts = countsByPath.get(file.path)
            const slash = file.path.lastIndexOf('/')
            return (
              <li className="dshx:group dshx:flex dshx:items-center dshx:gap-2 dshx:px-2 dshx:py-0.5 dshx:hover:bg-accent" key={file.path}>
                <span className={cn('dshx:w-3 dshx:flex-none dshx:font-mono! dshx:font-semibold', STATUS_CLASS[file.status])}>{file.status}</span>
                <button
                  className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:cursor-pointer dshx:items-baseline dshx:gap-1.5 dshx:text-left"
                  onClick={() => setFullDiffPath(file.path)}
                  title={file.path}
                  type="button"
                >
                  <span className="dshx:truncate dshx:text-foreground">{file.path.slice(slash + 1)}</span>
                  {slash > 0 && <span className="dshx:truncate dshx:text-muted-foreground">{file.path.slice(0, slash)}</span>}
                </button>
                {counts !== undefined && (
                  <span className="dshx:flex-none dshx:font-mono! dshx:tabular-nums">
                    <span className="dshx:text-success">+{counts.additions}</span> <span className="dshx:text-destructive">−{counts.deletions}</span>
                  </span>
                )}
                <Button aria-label={'Open diff of ' + file.path} onClick={() => setFullDiffPath(file.path)} size="icon-xs" title="Open diff" type="button" variant="ghost">
                  <FileDiffIcon />
                </Button>
                <Button
                  aria-label={'Open ' + file.path}
                  disabled={file.status === 'D'}
                  onClick={() => openFile(file.path)}
                  size="icon-xs"
                  title="Open file"
                  type="button"
                  variant="ghost"
                >
                  <FileCodeIcon />
                </Button>
              </li>
            )
          })}
          {repository.filesTruncated && <li className="dshx:px-2 dshx:py-0.5 dshx:text-muted-foreground">More files are not listed.</li>}
        </ul>
      )}
      {fullDiffPath !== undefined && (
        <FullDiffDialog
          error={diffQuery.isError ? 'Could not load the diff.' : null}
          focusPath={fullDiffPath}
          layout="unified"
          onClose={() => setFullDiffPath(undefined)}
          patch={diffQuery.data?.patch}
          title={heading + ' · ' + basename(repository.root)}
          truncated={diffQuery.data?.truncated ?? false}
        />
      )}
    </div>
  )
}

const Chip = (props: { readonly title: string; readonly onClick: () => void; readonly children: ReactNode }) => (
  <button
    className="dshx:flex dshx:min-w-0 dshx:cursor-pointer dshx:items-center dshx:gap-1 dshx:whitespace-nowrap dshx:rounded-md dshx:px-1.5 dshx:py-0.5 dshx:hover:bg-accent dshx:hover:text-foreground dshx:[&_svg]:size-3 dshx:[&_svg]:flex-none"
    onClick={props.onClick}
    title={props.title}
    type="button"
  >
    {props.children}
  </button>
)

/** Folder, JJ workspace and working-copy chips below the composer; each opens the Jujutsu panel. */
export const ComposerChips = (props: ComposerSlotProps): JSX.Element | null => {
  const context = useComposerContext(props, 'composerChips')
  const repository = context.repository
  if (repository === null) return null

  const ownBookmark = repository.bookmarks[0]
  const nearestBookmark = repository.nearestBookmarks[0]
  return (
    <div className="dshx-root dshx:flex dshx:max-w-full dshx:min-w-0 dshx:items-center dshx:gap-0.5 dshx:text-xs dshx:text-muted-foreground" ref={context.ref}>
      <Chip onClick={props.jujutsu.openJujutsu} title={repository.root}>
        <FolderIcon />
        <span className="dshx:max-w-40 dshx:truncate">{basename(repository.root)}</span>
      </Chip>
      {repository.workspace !== null && (
        <Chip onClick={props.jujutsu.openJujutsu} title={'JJ workspace ' + repository.workspace}>
          <LayersIcon />
          <span className="dshx:max-w-32 dshx:truncate">{repository.workspace}</span>
        </Chip>
      )}
      <Chip
        onClick={props.jujutsu.openJujutsu}
        title={'@ ' + repository.changeId + ' (' + repository.commitId + ')' + (repository.description.length > 0 ? ' — ' + repository.description : '')}
      >
        {ownBookmark !== undefined || nearestBookmark !== undefined ? <GitBranchIcon /> : <GitCommitHorizontalIcon />}
        <span className="dshx:font-mono!">@ {repository.changeId}</span>
        {repository.conflict && <span className="dshx:text-destructive">conflict</span>}
        {ownBookmark !== undefined ? (
          <span className="dshx:max-w-48 dshx:truncate dshx:text-foreground">· {ownBookmark}</span>
        ) : nearestBookmark !== undefined ? (
          <span className="dshx:max-w-48 dshx:truncate" title={'Nearest ancestor bookmark: ' + nearestBookmark}>
            · {nearestBookmark}+
          </span>
        ) : (
          <span>· detached</span>
        )}
      </Chip>
    </div>
  )
}
