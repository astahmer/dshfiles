import { getFiletypeFromFileName, parsePatchFiles, registerCustomTheme, type FileDiffMetadata } from '@pierre/diffs'
import { FileDiff, Virtualizer } from '@pierre/diffs/react'
import { useEffect, useMemo, useRef, useSyncExternalStore, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
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

  /** Explicit `+`/`−` gutter marks (`classic`), so a changed line reads without its colour. */
  static options(dark: boolean): Pick<DiffOptions, 'diffIndicators' | 'theme' | 'themeType'> {
    return { themeType: dark ? 'dark' : 'light', theme: { dark: THEME, light: THEME }, diffIndicators: 'classic' }
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
              renderHeaderMetadata={file => props.renderHeaderMetadata?.(file)}
              renderHeaderPrefix={file => props.renderHeaderPrefix?.(file)}
            />
          </div>
        ))}
      </Virtualizer>
    </div>
  )
}
