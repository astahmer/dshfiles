import { getFiletypeFromFileName, parsePatchFiles, registerCustomTheme, type FileDiffMetadata } from '@pierre/diffs'
import { FileDiff, Virtualizer } from '@pierre/diffs/react'
import { useEffect, useMemo, useRef, useSyncExternalStore, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { DiffStat } from './components/diff-stat.js'
import { cn } from './lib/utils.js'
import { bundledLanguages, createCssVariablesTheme } from './shiki-slim.js'
import { DiffLook } from './theme/diff-look.js'

export { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'

export type PatchLayout = 'unified' | 'split'

type PatchSource = { readonly patch: string; readonly files?: never } | { readonly files: readonly FileDiffMetadata[]; readonly patch?: never }

export type PatchViewProps = PatchSource & {
  readonly layout?: PatchLayout
  /** Scroll this file path into view once it is rendered. */
  readonly focusPath?: string | null
  readonly empty?: ReactNode
  readonly renderHeaderPrefix?: (file: FileDiffMetadata) => ReactNode
  /** Trailing slot of each sticky file header, e.g. per-file actions. */
  readonly renderHeaderMetadata?: (file: FileDiffMetadata) => ReactNode
  /**
   * Lets the user drag or click across line numbers to select lines, and reports the finished range: `side` says
   * whether the numbers are the new file's (`additions`) or the old file's (`deletions`). Without it lines are not
   * selectable.
   */
  readonly onLineSelection?: (input: PatchLineSelection) => void
  readonly className?: string
}

/** A finished line selection in one file of a patch, in that side's line numbers. */
export interface PatchLineSelection {
  readonly file: FileDiffMetadata
  readonly start: number
  readonly end: number
  readonly side: 'additions' | 'deletions'
}

const subscribeToDarkTheme = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => observer.disconnect()
}

/**
 * The slim set serves JavaScript with the TypeScript grammars, which do not declare the JavaScript names, and the diff
 * renderer refuses a grammar whose own names miss the language it asked for ("No returned grammar declares
 * javascript"). Ask for the grammar's own name instead.
 */
const GRAMMAR_NAME = new Map<string, 'typescript' | 'tsx'>([
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['mjs', 'typescript'],
  ['cjs', 'typescript'],
  ['jsx', 'tsx'],
])

/** Render grammars outside the slim Shiki set as plain text instead of failing to highlight. */
const withHighlightableLanguage = (file: FileDiffMetadata): FileDiffMetadata => {
  const language = file.lang ?? getFiletypeFromFileName(file.name)
  if (language === 'text') return file
  const grammar = GRAMMAR_NAME.get(language)
  if (grammar !== undefined) return { ...file, lang: grammar }
  return language in bundledLanguages ? file : { ...file, lang: 'text' }
}

type DiffOptions = NonNullable<ComponentProps<typeof FileDiff>['options']>

const isDarkTheme = (): boolean => document.body.hasAttribute('data-ds-dark-theme')

/** Follows the DSH theme switch (`body[data-ds-dark-theme]`), which is not a `prefers-color-scheme` signal. */
const useDshDarkTheme = (): boolean => useSyncExternalStore(subscribeToDarkTheme, isDarkTheme, () => false)

// The library renders inside shadow roots, so only inherited custom properties reach it.
const DIFF_FONT_STYLE = {
  '--diffs-font-family': 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  '--diffs-header-font-family': 'inherit',
  '--diffs-font-size': '12px',
  '--diffs-line-height': '18px',
} as const

/**
 * One syntax pair for the transcript and the diff (round five A4): the diff highlights with Shiki's `css-variables`
 * theme, whose token colours are the `--shiki-token-*` values the theme block fits for both schemes, the same ones the
 * transcript's code blocks read. Registered once with the diff library's theme resolver.
 */
const THEME = 'dshx-syntax'
registerCustomTheme(THEME, () => Promise.resolve(createCssVariablesTheme({ name: THEME, variablePrefix: '--shiki-' })))

/** Diff options and inherited style shared by every `PatchView`. */
export class PatchLook {
  static readonly THEME = THEME

  /**
   * The library's own header counts read `−N +N` in its mono face; the header shows the kit DiffStat instead
   * (`headerMetadata`), so they are hidden inside the shadow root (council round 3, D5). The file name reads 13/18 at
   * 600, one step above the 12 px code, so a file starts where its name is (council round 4, D3).
   *
   * The collapsed-lines bar (council round 6 D2, round 7 A3) runs edge to edge with square ends, like the diff rows
   * around it: no inset on either side (the library pads the right by its 8px gap). Its grid sets the code face, so
   * `--dshx-diff-gutter` measures the line-number column exactly (its digits, 2ch before and 1ch after them, the 2px
   * rule): an expandable bar puts a 14px chevron in that gutter and its label 2ch past it, where the code starts
   * (classic indicators pad a line 2ch); a bar that cannot expand has no chevron and starts its label at the same inset.
   * The label itself keeps the header face.
   */
  static readonly HEADER_CSS =
    '[data-deletions-count], [data-additions-count] { display: none; } [data-title] { font-size: 13px; line-height: 18px; font-weight: 600; } ' +
    '[data-separator=line-info] [data-separator-wrapper] { padding-inline: 0; font-family: var(--diffs-font-family, var(--diffs-font-fallback)); ' +
    '--dshx-diff-gutter: calc(var(--diffs-min-number-column-width, var(--diffs-min-number-column-width-default, 3ch)) + 3ch + 2px); } ' +
    '[data-separator=line-info] [data-separator-content] { border-radius: 0; } ' +
    '[data-separator=line-info][data-expand-index] [data-separator-wrapper], [data-separator=line-info][data-expand-index] [data-separator-wrapper][data-separator-multi-button] { grid-template-columns: var(--dshx-diff-gutter) auto; } ' +
    '[data-separator=line-info][data-expand-index] [data-separator-content] { padding-inline: 2ch 1ch; } ' +
    '[data-separator=line-info]:not([data-expand-index]) [data-separator-content] { padding-inline: calc(var(--dshx-diff-gutter) + 2ch) 1ch; } ' +
    '[data-separator=line-info] [data-expand-button] { min-width: 0; border-radius: 0; } ' +
    '[data-expand-button] [data-icon] { width: 14px; height: 14px; } ' +
    '[data-unmodified-lines] { font-family: var(--diffs-header-font-family, var(--diffs-header-font-fallback)); }'

  /**
   * The bar's label in our words (council round 7 A3): "Show N unchanged lines" where it expands, "N unchanged lines"
   * where it cannot (a patch without the file). The library writes "N unmodified lines" with no option to change it,
   * so each render rewrites the label inside the shadow root; idempotent, and a bar that changes state is relabelled.
   */
  static relabelSeparators(root: ParentNode): void {
    for (const label of root.querySelectorAll('[data-unmodified-lines]')) {
      const count = /^(?:Show )?(\d+) (?:unmodified|unchanged) lines?$/u.exec(label.textContent ?? '')?.[1]
      if (count === undefined) continue
      const text = `${label.closest('[data-expand-index]') === null ? '' : 'Show '}${count} unchanged line${count === '1' ? '' : 's'}`
      if (label.textContent !== text) label.textContent = text
    }
  }

  /** Explicit `+`/`−` gutter marks (`classic`), so a changed line reads without its colour; the bar relabelled. */
  static options(dark: boolean): Pick<DiffOptions, 'diffIndicators' | 'theme' | 'themeType' | 'unsafeCSS' | 'onPostRender'> {
    return {
      themeType: dark ? 'dark' : 'light',
      theme: { dark: THEME, light: THEME },
      diffIndicators: 'classic',
      unsafeCSS: PatchLook.HEADER_CSS,
      onPostRender: (node, _instance, phase) => {
        if (phase !== 'unmount') PatchLook.relabelSeparators(node.shadowRoot ?? node)
      },
    }
  }

  /** A file header's trailing slot: the file's change count as the kit DiffStat (`+N −N`), then what the caller adds. */
  static headerMetadata(file: FileDiffMetadata, extra: ReactNode): ReactNode {
    let added = 0
    let removed = 0
    for (const hunk of file.hunks) {
      added += hunk.additionLines
      removed += hunk.deletionLines
    }
    // One row: the slot stacks its children otherwise, which put the count above the caller's control.
    return (
      <span className="dshx:flex dshx:items-center dshx:gap-3" data-patch-header-metadata="">
        <DiffStat added={added} removed={removed} />
        {extra}
      </span>
    )
  }

  /** Font, ramp body, 12% line tints and the shared syntax pair, as custom properties the shadow roots inherit. */
  static style(dark: boolean): CSSProperties {
    // SAFETY: CSSProperties has no index for custom properties; every key here is a --diffs-* or --shiki-* variable.
    return { ...DIFF_FONT_STYLE, ...DiffLook.style(dark ? 'dark' : 'light') } as CSSProperties
  }
}

/**
 * Virtualized, syntax-highlighted view of a git patch (`jj diff --git`, `git diff`) or pre-parsed files.
 * Each file mounts in its own shadow root, so the library's CSS never reaches the page.
 */
export const PatchView = (props: PatchViewProps): JSX.Element => {
  const dark = useDshDarkTheme()
  const root = useRef<HTMLDivElement | null>(null)
  const files = useMemo(
    () => (props.files ?? (props.patch === undefined ? [] : parsePatchFiles(props.patch).flatMap(parsed => parsed.files))).map(withHighlightableLanguage),
    [props.files, props.patch],
  )
  const layout = props.layout ?? 'unified'

  useEffect(() => {
    if (props.focusPath === null || props.focusPath === undefined || files.length === 0) return
    root.current?.querySelector(`[data-diff-path="${CSS.escape(props.focusPath)}"]`)?.scrollIntoView({ block: 'start' })
  }, [files, props.focusPath])

  /** Line selection is offered only when the caller handles it. */
  const diffOptions = (file: FileDiffMetadata): DiffOptions => {
    const base: DiffOptions = {
      diffStyle: layout,
      ...PatchLook.options(dark),
      stickyHeader: true,
      hunkSeparators: 'line-info',
      overflow: 'scroll',
    }
    if (props.onLineSelection === undefined) return base
    return {
      ...base,
      enableLineSelection: true,
      onLineSelectionEnd: range => {
        if (range === null) return
        const start = Math.min(range.start, range.end)
        const end = Math.max(range.start, range.end)
        props.onLineSelection?.({ file, start, end, side: (range.endSide ?? range.side) === 'deletions' ? 'deletions' : 'additions' })
      },
    }
  }

  if (files.length === 0) return <>{props.empty ?? null}</>

  return (
    <div className={cn('dshx:min-h-0 dshx:overflow-hidden', props.className)} ref={root} style={PatchLook.style(dark)}>
      <Virtualizer className="dshx:size-full dshx:overflow-auto dshx:overscroll-contain">
        {files.map(file => (
          <div data-diff-path={file.name} key={`${file.prevName ?? ''}\u0000${file.name}`}>
            <FileDiff
              fileDiff={file}
              options={diffOptions(file)}
              renderHeaderMetadata={file => PatchLook.headerMetadata(file, props.renderHeaderMetadata?.(file))}
              renderHeaderPrefix={file => props.renderHeaderPrefix?.(file)}
            />
          </div>
        ))}
      </Virtualizer>
    </div>
  )
}
