import type { BacklogSummaryView } from './api.js'

type MarkdownItem = {
  readonly id: BacklogSummaryView['id']
  readonly title: BacklogSummaryView['title']
  readonly kind: BacklogSummaryView['kind']
  readonly status: BacklogSummaryView['status']
  readonly project: BacklogSummaryView['project']
  readonly tags: readonly BacklogSummaryView['tags'][number][]
  readonly links: readonly BacklogSummaryView['links'][number][]
  readonly body?: string | undefined
  readonly preview?: string | undefined
}

export const backlogItemMarkdown = (item: MarkdownItem): string => {
  const metadata = [
    `- **ID:** \`b:${String(item.id)}\``,
    `- **Kind:** ${item.kind}`,
    `- **Status:** ${item.status}`,
    ...(item.project === null ? [] : [`- **Project:** \`${item.project}\``]),
    ...(item.tags.length === 0 ? [] : [`- **Tags:** ${item.tags.map(tag => `#${tag}`).join(' ')}`]),
  ]
  const body = item.body ?? item.preview ?? ''
  const links = item.links.map(link => `- ${link.type}: ${link.target}`)

  return [`# ${item.title}`, '', ...metadata, ...(body.length === 0 ? [] : ['', body]), ...(links.length === 0 ? [] : ['', '## Links', ...links])].join('\n')
}
