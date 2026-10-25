import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActorThreadLink } from './actor-thread-link.js'

const render = (actorId: string): string => renderToStaticMarkup(<ActorThreadLink actorId={actorId} openThread={() => undefined} />)

describe('activity actor thread link', () => {
  it('links an agent actor to the thread it worked in', () => {
    const html = render('agent:session-077d59d5-cfc9-4c48-924d-2673ccf96a49')

    expect(html).toContain('href="?thread=session-077d59d5-cfc9-4c48-924d-2673ccf96a49"')
    expect(html).toContain('aria-label="Open the thread of Agent 077d59"')
    expect(html).toContain('>Agent 077d59</a>')
  })

  it('keeps a human and an automatic actor as plain text', () => {
    expect(render('user')).toBe('<span>You</span>')
    expect(render('system')).toBe('<span>Automatic</span>')
  })
})
