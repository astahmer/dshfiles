import type { ToolCallSectionProps } from '@dshfiles/tool-meta/tool-call-sections'
import { ToolCallSections } from '@dshfiles/tool-meta/tool-call-sections'
import { defineClient } from '@dshfiles/dshx/client'
import { CitationSection } from './citation-section.js'

/** Under every tool card, the section answers only web results; tool-meta's frame is the one seat for extra row content. */
export default defineClient({
  name: '@dshfiles/web-fetch-readable',
  inject: [],
  setup(_ctx, _decorate, metadata) {
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    const Section = (props: ToolCallSectionProps): JSX.Element | null => <CitationSection owner={props.owner} />
    plugin.add(ToolCallSections, { id: '@dshfiles/web-fetch-readable/citations', order: 20, Section: plugin.bind(Section) })
  },
})
