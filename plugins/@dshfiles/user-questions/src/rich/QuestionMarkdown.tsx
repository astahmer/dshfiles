import { memo, useMemo, type ComponentProps, type MouseEvent } from 'react'
import { MarkdownText, type MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import { FencedMarkdown } from '@dshfiles/chat/fenced-markdown'
import { fileMediaUrl } from '@deepseek-ai/dsh-util-workspace-path'
import { useRegistry } from '@dshfiles/dshx/client'
import { QuestionHtmlPreview } from '../html-preview.ts'
import { QuestionMarkdownText } from './question-markdown.ts'
import css from './QuestionMarkdown.module.css'

type MarkdownLabels = ComponentProps<typeof MarkdownText>['labels']

/**
 * An absolute local image path becomes the document's file-API URL, as the chat transcript resolves it; anything
 * else (a relative path, an unsupported scheme) stays unresolved and renders as its alt text.
 */
const pathImages: MarkdownPathImages = {
  resolve: value => {
    let path: string
    try {
      path = decodeURIComponent(value.split(/[?#]/u)[0] ?? '')
    } catch {
      return undefined
    } // A malformed escape names no file.
    return fileMediaUrl(document.baseURI, path)
  },
}

/** A fence the form cannot sandbox shows its markup as code: the page never runs outside an isolated frame. */
const codeFence = (html: string): string => {
  const longest = Math.max(2, ...Array.from(html.matchAll(/`+/g), match => match[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}html\n${html}\n${fence}`
}

interface QuestionMarkdownProps {
  /** Markdown body of the question (its heading already taken out). */
  readonly text: string
  /** Fence and footnote chrome, reference-stable per locale revision. */
  readonly labels: MarkdownLabels
  /** Fallback accessible name of an untitled preview. */
  readonly previewTitle: string
}

/**
 * The question's rich body: GFM markdown (links, images, tables, code, math) through the native renderer, and each
 * ```` ```html preview ```` fence through the registered sandboxed renderer.
 */
export const QuestionMarkdown = memo(function QuestionMarkdown(props: QuestionMarkdownProps) {
  const segments = useMemo(() => QuestionMarkdownText.segments(props.text), [props.text])
  const renderer = useRegistry(QuestionHtmlPreview)[0]
  if (segments.length === 0) return null
  return (
    <div className={css.body} data-question-markdown="">
      {segments.map((segment, index) => {
        const key = `${segment.kind}-${String(index)}`
        if (segment.kind === 'markdown') {
          return <FencedMarkdown key={key} text={segment.text} labels={props.labels} pathImages={pathImages} />
        }
        const caption = segment.title ?? props.previewTitle
        if (renderer === undefined) {
          return <MarkdownText key={key} text={codeFence(segment.html)} labels={props.labels} />
        }
        const Preview = renderer.Component
        return (
          <div key={key} className={css.preview} data-question-html-preview="">
            <Preview html={segment.html} caption={caption} />
          </div>
        )
      })}
    </div>
  )
})

/** Inside an option row a link must open, not pick the option. */
const isLinkClick = (event: MouseEvent<HTMLElement>): boolean => event.target instanceof Element && event.target.closest('a') !== null

interface OptionDescriptionProps {
  readonly id: string
  readonly text: string
  readonly labels: MarkdownLabels
  /** Selects the option: the description is part of the row's hit area. */
  readonly onSelect: (() => void) | undefined
}

/**
 * An option's description: plain prose renders as text, markdown (bold, code, links) through the compact renderer.
 * It sits beside the option button rather than inside it, so a link stays a real link and the button keeps a short
 * accessible name; the button names it with `aria-describedby`.
 */
export const OptionDescription = memo(function OptionDescription(props: OptionDescriptionProps) {
  const rich = QuestionMarkdownText.hasSyntax(props.text)
  return (
    // The button is the keyboard target; this click only widens its pointer hit area.
    <div
      id={props.id}
      className={css.optionDescription}
      data-question-option-description=""
      onClick={event => {
        if (!isLinkClick(event)) props.onSelect?.()
      }}
    >
      {rich ? <FencedMarkdown text={props.text} labels={props.labels} pathImages={pathImages} variant="compact" /> : props.text}
    </div>
  )
})

interface QuestionTitleProps {
  readonly id: string
  readonly className: string | undefined
  readonly text: string
  readonly labels: MarkdownLabels
}

/**
 * The heading line: plain prose in the native `h2` exactly as before; inline markdown (a link, `code`, emphasis)
 * through the compact renderer in an ARIA heading, because the renderer's block wrapper is not `h2` content.
 */
export const QuestionTitle = memo(function QuestionTitle(props: QuestionTitleProps) {
  if (!QuestionMarkdownText.hasSyntax(props.text))
    return (
      <h2 className={props.className} id={props.id}>
        {props.text}
      </h2>
    )
  return (
    <div className={[props.className, css.title].filter(Boolean).join(' ')} id={props.id} role="heading" aria-level={2}>
      <MarkdownText text={props.text} labels={props.labels} variant="compact" />
    </div>
  )
})
