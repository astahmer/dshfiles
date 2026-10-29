import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'

import { ActivityDescription } from './activity-description.js'

const render = (description: string, threadId: string): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <p>
        <ActivityDescription
          description={description}
          threadId={threadId}
          threadLabel={() => 'we probably can skip calling jev to decide stuff'}
          openThread={() => undefined}
        />
      </p>
    </TooltipProvider>,
  )

describe('activity description thread link', () => {
  it('flows the thread reference inline with the surrounding text instead of as a button box', () => {
    const html = render('moved it inbox → doing (mentioned in a thread)', 'session-abc123')

    expect(html).not.toContain('<button')
    expect(html).toMatch(
      /^<p>moved it inbox → doing \(mentioned in <a href="\?thread=session-abc123"[^>]*>a thread “we probably can skip calling jev to decide stuff”<\/a>\)<\/p>$/,
    )
  })

  it('links a linked-thread event inline', () => {
    const html = render('linked thread:session-abc123', 'session-abc123')

    expect(html).toMatch(/^<p>linked <a href="\?thread=session-abc123"[^>]*>the thread “[^”]+”<\/a><\/p>$/)
  })
})
