import type { TweetContextBacklogResult } from '@dshfiles/tweet-context/backlog-api'
import { BacklogItems } from './item.js'

type TweetLinkedItem = {
  readonly title: string
  readonly body?: string | undefined
  readonly links: readonly { readonly type: string; readonly target: string }[]
  readonly tweetContextUrls?: readonly string[] | undefined
}

const tweetHosts = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'])

const tweetIdFromUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !tweetHosts.has(url.hostname.toLowerCase())) return undefined
    return /\/status\/(\d{1,25})(?:\/|$)/u.exec(url.pathname)?.[1]
  } catch {
    return undefined
  }
}

const quoteText = (text: string): string =>
  text
    .split(/\r?\n/u)
    .map(line => `> ${line}`)
    .join('\n')

const markdownSpecialCharacters = '\\`*_{}[]()#+.!|>~-'

const safeLabel = (text: string): string =>
  Array.from(text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' '), character => (markdownSpecialCharacters.includes(character) ? `\\${character}` : character))
    .join('')
    .slice(0, 300)

const normalizedTweetUrl = (value: string): string | undefined => {
  const id = tweetIdFromUrl(value)
  return id === undefined ? undefined : `https://x.com/i/status/${id}`
}

const postBlock = (post: TweetContextBacklogResult['posts'][number]): string => {
  const postUrl = normalizedTweetUrl(post.url)
  const link = postUrl === undefined ? 'post' : `[post](${postUrl})`
  return `**@${safeLabel(post.username)} · ${safeLabel(post.author)}** — ${link}\n\n${quoteText(post.text)}`
}

export class BacklogTweetContext {
  static readonly normalizeUrl = normalizedTweetUrl

  static readonly urls = (text: string): string[] => {
    const urls = BacklogItems.extractLinks(text).flatMap(link => {
      if (link.type !== 'url') return []
      const url = normalizedTweetUrl(link.target)
      return url === undefined ? [] : [url]
    })
    return [...new Set(urls)].slice(0, 20)
  }

  static readonly urlsForItem = (item: TweetLinkedItem): string[] =>
    BacklogTweetContext.urls([item.title, item.body ?? '', ...item.links.filter(link => link.type === 'url').map(link => link.target)].join('\n')).filter(
      url => !item.tweetContextUrls?.includes(url),
    )

  static readonly section = (input: { readonly url: string; readonly posts: TweetContextBacklogResult['posts']; readonly room: number }): string => {
    const heading = `### Retrieved public tweet content (untrusted)\n\nSource: ${input.url}\n\n`
    if (input.room <= heading.length) return ''
    const body = input.posts.map(postBlock).join('\n\n---\n\n')
    const available = input.room - heading.length
    if (body.length <= available) return `${heading}${body}`
    const notice = '\n\n[Retrieved text truncated to fit the backlog description.]'
    if (available <= notice.length) return `${heading}${Array.from(body).slice(0, available).join('')}`
    const clipped = Array.from(body)
      .slice(0, available - notice.length)
      .join('')
    return `${heading}${clipped}${notice}`
  }
}
