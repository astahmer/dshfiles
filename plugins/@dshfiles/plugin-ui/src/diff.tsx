import { getFiletypeFromFileName, parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { FileDiff, Virtualizer } from '@pierre/diffs/react'
import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { cn } from './lib/utils.js'
import { bundledLanguages } from './shiki-slim.js'

export { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'

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
  readonly className?: string
}

const subscribeToDarkTheme = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => observer.disconnect()
}

/** Render grammars outside the slim Shiki set as plain text instead of failing to highlight. */
const withHighlightableLanguage = (file: FileDiffMetadata): FileDiffMetadata => {
  const language = file.lang ?? getFiletypeFromFileName(file.name)
  return language === 'text' || language in bundledLanguages ? file : { ...file, lang: 'text' }
}

const isDarkTheme = (): boolean => document.body.hasAttribute('data-ds-dark-theme')

/** Follows the DSH theme switch (`body[data-ds-dark-theme]`), which is not a `prefers-color-scheme` signal. */
const useDshDarkTheme = (): boolean => useSyncExternalStore(subscribeToDarkTheme, isDarkTheme, () => false)

// The library renders inside shadow roots, so only inherited custom properties reach it.
const DIFF_FONT_STYLE = {
  '--diffs-font-family': 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  '--diffs-header-font-family': 'inherit',
  '--diffs-font-size': '12px',
  '--diffs-line-height': '18px',
} as CSSProperties

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

  if (files.length === 0) return <>{props.empty ?? null}</>

  return (
    <div className={cn('dshx:min-h-0 dshx:overflow-hidden', props.className)} ref={root} style={DIFF_FONT_STYLE}>
      <Virtualizer className="dshx:size-full dshx:overflow-auto dshx:overscroll-contain">
        {files.map(file => (
          <div data-diff-path={file.name} key={`${file.prevName ?? ''}\u0000${file.name}`}>
            <FileDiff
              fileDiff={file}
              options={{
                diffStyle: layout,
                themeType: dark ? 'dark' : 'light',
                theme: { dark: 'pierre-dark', light: 'pierre-light' },
                stickyHeader: true,
                hunkSeparators: 'line-info',
                overflow: 'scroll',
              }}
              renderHeaderMetadata={file => props.renderHeaderMetadata?.(file)}
              renderHeaderPrefix={file => props.renderHeaderPrefix?.(file)}
            />
          </div>
        ))}
      </Virtualizer>
    </div>
  )
}
