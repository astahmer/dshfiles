import { describe, expect, it } from 'vitest'
import { Processes } from './processes-page.js'
import type { ProcessView } from './process-views.js'

const Page = (): null => null
const Thread = (): null => null

describe('Processes', () => {
  it('orders tabs after Jobs, one per id, and never lets a provider replace Jobs', () => {
    const views: readonly ProcessView[] = [
      { id: 'ram', label: 'RAM', order: 20, Page, Thread },
      { id: 'dev-servers', label: 'Dev servers', order: 10, Page, Thread },
      { id: 'ram', label: 'RAM again', order: 0, Page },
      { id: 'jobs', label: 'Jobs', Page },
    ]
    expect(Processes.ordered(views).map(view => view.label)).toEqual(['Dev servers', 'RAM'])
  })

  it('gives the Jobs facet only the views that can filter to one thread', () => {
    const views: readonly ProcessView[] = [
      { id: 'ram', label: 'RAM', order: 20, Page, Thread },
      { id: 'hosts', label: 'Hosts', order: 5, Page },
    ]
    expect(Processes.threadViews(views).map(view => view.id)).toEqual(['ram'])
  })

  it('selects a tab for the navigation contract', () => {
    Processes.select('ram')
    expect(Processes.selected()).toBe('ram')
    Processes.select('jobs')
    expect(Processes.selected()).toBe('jobs')
  })
})
