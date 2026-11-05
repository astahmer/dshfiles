/**
 * Readable-article extraction: Mozilla Readability over a linkedom document.
 *
 * `dsh-tool-web` converts whatever HTML the provider returns to markdown, navigation and footers
 * included, and then caps it. Handing it the article instead keeps the model's budget for the page's
 * content. A page Readability cannot find an article in keeps its full HTML.
 */
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

/** Above this, parsing costs more than the extraction saves; the tool still converts the full page. */
export const MAX_EXTRACT_INPUT_CHARS = 3_000_000

/** An "article" shorter than this is usually a cookie banner or a teaser; keep the full page. */
const MIN_ARTICLE_TEXT_CHARS = 200

export type Extraction =
  | { readonly kind: 'article'; readonly html: string; readonly textChars: number }
  | { readonly kind: 'full'; readonly reason: 'too-large' | 'no-article' | 'failed' }

const escapeHtml = (text: string): string => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

export class ArticleExtractor {
  static extract(html: string, url: string): Extraction {
    if (html.length > MAX_EXTRACT_INPUT_CHARS) return { kind: 'full', reason: 'too-large' }
    try {
      const { document } = parseHTML(html)
      ArticleExtractor.setBase(document, url)
      const article = new Readability(document, { keepClasses: false }).parse()
      const content = article?.content ?? ''
      const textChars = (article?.textContent ?? '').trim().length
      if (article === null || content === '' || textChars < MIN_ARTICLE_TEXT_CHARS) return { kind: 'full', reason: 'no-article' }
      const title = (article.title ?? '').trim()
      const byline = (article.byline ?? '').trim()
      const heading = title === '' ? '' : `<h1>${escapeHtml(title)}</h1>`
      const credit = byline === '' ? '' : `<p>${escapeHtml(byline)}</p>`
      return { kind: 'article', html: `<article>${heading}${credit}${content}</article>`, textChars }
    } catch {
      // Readability throws on some malformed trees; the full page is still a correct answer.
      return { kind: 'full', reason: 'failed' }
    }
  }

  /** Readability rewrites relative links against the document base; linkedom has no URL, so give it one. */
  private static setBase(document: Document, url: string): void {
    if (document.querySelector('base[href]') !== null) return
    const base = document.createElement('base')
    base.setAttribute('href', url)
    const head = document.head ?? document.documentElement
    head?.prepend(base)
  }
}
