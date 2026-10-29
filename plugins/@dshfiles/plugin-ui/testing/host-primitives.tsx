/**
 * Test double for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The Host serves that package as a platform module; its published runtime
 * dependencies are dev-only, so Node cannot import it. This double keeps the
 * same props and the semantics tests assert on (roles, names, disabled state)
 * so plugin tests can alias the specifier here instead of mocking per test.
 */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; icon?: ReactNode }>(
  ({ variant: _variant, size: _size, icon, children, ...rest }, ref) => (
    <button ref={ref} {...rest}>
      {icon}
      {children}
    </button>
  ),
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(({ icon: _icon, ...rest }, ref) => (
  <input ref={ref} {...rest} />
))

export const Checkbox = (props: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string | undefined
}): JSX.Element => (
  <label title={props.title}>
    <input checked={props.checked} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.checked)} type="checkbox" />
    {props.label}
  </label>
)

export const Switch = (props: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string | undefined
}): JSX.Element => (
  <button
    aria-checked={props.checked}
    aria-label={props.label}
    disabled={props.disabled}
    onClick={() => props.onChange(!props.checked)}
    role="switch"
    title={props.title}
    type="button"
  />
)

export const Tag = (props: { tone?: string; className?: string | undefined; children?: ReactNode }): JSX.Element => (
  <span data-tone={props.tone}>{props.children}</span>
)

export const writeClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const StateDot = (props: { state: string }): JSX.Element => <span aria-hidden data-state={props.state} />

export const Tooltip = (props: { content?: ReactNode; label?: ReactNode; children?: ReactNode }): JSX.Element => <>{props.children}</>

export const Modal = (props: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  closeLabel?: string
}): JSX.Element | null =>
  props.open ? (
    <div aria-label={props.title} aria-modal="true" role="dialog">
      <h2>{props.title}</h2>
      {props.description !== undefined && <p>{props.description}</p>}
      {props.children}
      {props.footer}
      {props.closeLabel !== undefined && (
        <button aria-label={props.closeLabel} onClick={props.onClose} type="button">
          ×
        </button>
      )}
    </div>
  ) : null

const icon = (): JSX.Element => <svg aria-hidden />

export const IconCloseOutlineRegular = icon
export const IconCheckOutlineRegular = icon
export const IconEditOutlineRegular = icon
export const IconTrashOutlineRegular = icon
export const IconDownloadOutlineMedium = icon
export const IconLoadingOutlineMedium = icon
export const IconAgentPresetOutlineMedium = icon
export const IconArchiveOutlineMedium = icon
export const IconDataOutlineMedium = icon
export const IconPersonalizationOutlineMedium = icon
export const IconSettingsOutlineMedium = icon
export const IconUserOutlineMedium = icon
export const IconSettingsOutlineRegular = icon

/** Host ranking contract without its alignment score: a case-insensitive ordered subsequence of the name or label, prefix hits first, then source order. */
export const rankByName = <T extends { readonly name: string; readonly label?: string }>(items: readonly T[], rawQuery: string): readonly T[] => {
  const query = rawQuery.trim().toLowerCase()
  if (query === '') return items
  const keys = (item: T): string[] => [item.name, item.label ?? ''].map(key => key.toLowerCase())
  const containsInOrder = (key: string): boolean =>
    [...key].reduce((matched, character) => (character === query[matched] ? matched + 1 : matched), 0) === query.length
  const prefixHit = (item: T): number => (keys(item).some(key => key.startsWith(query)) ? 0 : 1)
  return items.filter(item => keys(item).some(containsInOrder)).sort((left, right) => prefixHit(left) - prefixHit(right))
}

const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/gu

/** Renders only `[label](href)` links, keeping http(s) and mailto hrefs as the Host renderer does. */
export const MarkdownText = (props: { text: string; variant?: string; streaming?: boolean }): JSX.Element => {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of props.text.matchAll(MARKDOWN_LINK)) {
    parts.push(props.text.slice(last, match.index))
    const href = match[2] ?? ''
    parts.push(/^(https?|mailto):/u.test(href) ? <a key={match.index} href={href}>{match[1]}</a> : match[1])
    last = match.index + match[0].length
  }
  parts.push(props.text.slice(last))
  return <div data-variant={props.variant}>{parts}</div>
}

export const CodeBlock = (props: { code: string; lang?: string | undefined; copyLabel: string; showHeader?: boolean }): JSX.Element => (
  <pre data-lang={props.lang} aria-label={props.showHeader === false ? undefined : props.copyLabel}>
    {props.code}
  </pre>
)
