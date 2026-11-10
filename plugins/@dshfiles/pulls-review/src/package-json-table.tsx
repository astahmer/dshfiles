import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import type { FileDiffMetadata } from '@dshfiles/plugin-ui/diff'
import { useMemo, useState, type ReactNode } from 'react'
import { PackageJsonChangesModel, type DependencyChangeKind, type DependencySection, type PackageJsonChanges } from './package-json-changes.js'

const KIND_VARIANT = { added: 'success', removed: 'destructive', updated: 'info' } as const satisfies Record<DependencyChangeKind, string>

const SECTION_LABEL = {
  dependencies: 'dep',
  devDependencies: 'dev',
  peerDependencies: 'peer',
  optionalDependencies: 'optional',
} as const satisfies Record<DependencySection, string>

const NONE_SHOWN: ReadonlySet<string> = new Set()

const otherLinesLabel = (count: number): string => (count === 1 ? '1 other line' : `${String(count)} other lines`)

export interface PackageJsonTablesView {
  readonly files: readonly PackageJsonChanges[]
  /** The parsed files a patch view still shows as text: all but the tables that stand in for theirs. */
  readonly textFiles: readonly FileDiffMetadata[]
  /** The file shows as a table whose text is hidden. */
  readonly isTextHidden: (path: string) => boolean
  readonly showText: (path: string) => void
  readonly hideText: (path: string) => void
}

/**
 * The package.json tables of one patch and which of them show their text again. A confident table replaces its file's
 * text diff; the choice to show it again belongs to that patch, so another patch (another thread, scope or revision)
 * starts with every table in place.
 */
export const usePackageJsonTables = (patch: string, parsedFiles: readonly FileDiffMetadata[]): PackageJsonTablesView => {
  const files = useMemo(() => PackageJsonChangesModel.read(patch), [patch])
  const [shown, setShown] = useState<{ readonly patch: string; readonly paths: ReadonlySet<string> }>(() => ({ patch, paths: new Set() }))
  const shownPaths = shown.patch === patch ? shown.paths : NONE_SHOWN
  const hidden = useMemo(() => new Set(files.filter(file => file.confident && !shownPaths.has(file.path)).map(file => file.path)), [files, shownPaths])
  const textFiles = useMemo(() => (hidden.size === 0 ? parsedFiles : parsedFiles.filter(file => !hidden.has(file.name))), [hidden, parsedFiles])
  const setText = (path: string, show: boolean): void =>
    setShown(current => {
      const paths = new Set(current.patch === patch ? current.paths : [])
      if (show) paths.add(path)
      else paths.delete(path)
      return { patch, paths }
    })
  return {
    files,
    textFiles,
    isTextHidden: path => hidden.has(path),
    showText: path => setText(path, true),
    hideText: path => setText(path, false),
  }
}

/**
 * Dependency changes of each changed `package.json` as a table. A confident table replaces the file's text diff, and
 * "Show text diff" puts the lines back; a table with rows outside a named section keeps the text on screen.
 */
export const PackageJsonTables = (props: {
  readonly view: PackageJsonTablesView
  readonly onShowText?: (path: string) => void
  /** The per-file controls a hidden text diff carried in its header (viewed or reviewed marks). */
  readonly headerActions?: (path: string) => ReactNode
}): JSX.Element | null => {
  const { view } = props
  if (view.files.length === 0) return null
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3" data-testid="package-json-changes">
      {view.files.map(file => {
        const hidden = view.isTextHidden(file.path)
        return (
          <section
            aria-label={`Dependency changes: ${file.path}`}
            className="dshx:rounded-md dshx:border dshx:border-border"
            data-package-json={file.path}
            key={file.path}
          >
            <header className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-2 dshx:py-1">
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs">{file.path}</span>
              <span className="dshx:text-xs dshx:text-muted-foreground">
                {file.changes.length === 1 ? '1 dependency' : `${String(file.changes.length)} dependencies`}
              </span>
              {file.confident ? (
                <Button
                  aria-pressed={!hidden}
                  onClick={() => {
                    if (hidden) {
                      view.showText(file.path)
                      props.onShowText?.(file.path)
                    } else view.hideText(file.path)
                  }}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  {hidden ? 'Show text diff' : 'Hide text diff'}
                </Button>
              ) : null}
              {hidden ? props.headerActions?.(file.path) : null}
            </header>
            {file.confident ? null : (
              <p className="dshx:border-b dshx:border-border dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground" role="note">
                Some rows sit in a section this diff does not name, so they may not be dependencies; the text diff stays below.
              </p>
            )}
            {file.confident && hidden && file.otherLines > 0 ? (
              <p className="dshx:border-b dshx:border-border dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground" role="note">
                This file also changes {otherLinesLabel(file.otherLines)} that are not dependencies; show the text diff to read them.
              </p>
            ) : null}
            <Table className="dshx:text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Previous</TableHead>
                  <TableHead>New</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {file.changes.map(change => (
                  <TableRow key={`${change.section ?? ''}:${change.name}`}>
                    <TableCell className="dshx:font-mono">
                      {change.name}
                      {change.section === null ? null : <span className="dshx:ml-1.5 dshx:text-muted-foreground">{SECTION_LABEL[change.section]}</span>}
                    </TableCell>
                    <TableCell className="dshx:font-mono dshx:text-muted-foreground">{change.before ?? '—'}</TableCell>
                    <TableCell className="dshx:font-mono">{change.after ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={KIND_VARIANT[change.kind]}>{change.kind}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )
      })}
    </div>
  )
}
