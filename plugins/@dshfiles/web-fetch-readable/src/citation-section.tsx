import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useSettings } from '@dshfiles/dshx/client'
import { useMemo } from 'react'
import { CitationChips } from './citation-chips.js'
import { CitationSources } from './citation-sources.js'
import { readableFetchSettings } from './settings.js'

/** A web result's text parts hold the fetched page; the article title is its first level-one heading. */
const resultText = (owner: ToolCallOwnerProps): string | undefined => {
  if (owner.phase !== 'result') return undefined
  const parts = owner.block.content.flatMap(part => (part.type === 'text' ? [part.text] : []))
  return parts.length === 0 ? undefined : parts.join('\n')
}

/**
 * Source chips for a `web_search` or `web_fetch` result, contributed under the tool card through tool-meta's
 * `tool.call.sections` seat: the native row keeps its own view, and a call of any other tool renders nothing.
 */
export const CitationSection = (props: { readonly owner: ToolCallOwnerProps }): JSX.Element | null => {
  const enabled = useSettings(readableFetchSettings).value?.citations !== false
  const owner = props.owner
  const facts = useMemo(
    () => ({
      toolName: owner.toolName,
      phase: owner.phase,
      isError: owner.phase === 'result' && owner.block.isError,
      meta: owner.phase === 'result' ? owner.block.meta : undefined,
      text: resultText(owner),
    }),
    [owner],
  )
  const sources = useMemo(() => CitationSources.citationSourcesOf(facts), [facts])
  if (!enabled || sources.length === 0) return null
  return <CitationChips sources={sources} />
}
