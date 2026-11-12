import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SetupPack, SetupPlanResult } from './api.js'
import { ReviewScreen } from './app.js'

const home = '/tmp/scratch-home'
const packs: readonly SetupPack[] = [
  { id: 'core', title: 'Core', summary: 'The shell every other pack builds on.', core: true, plugins: ['thread-sidebar'] },
  { id: 'knowledge', title: 'Knowledge', summary: 'Memory across threads.', core: false, plugins: ['memory'] },
]
const command = `node scripts/profile-sync.ts --profile main --home ${home} --bundle @dshfiles/thread-sidebar`
const result: SetupPlanResult = {
  plan: {
    profile: 'main',
    profileRoot: `${home}/profiles/main`,
    packs: [
      { id: 'core', title: 'Core' },
      { id: 'knowledge', title: 'Knowledge' },
    ],
    plugins: ['@dshfiles/thread-sidebar', '@dshfiles/memory', '@dshfiles/shared-runtime'],
    suppliers: ['@dshfiles/shared-runtime'],
    kept: [],
    created: true,
    linked: ['@dshfiles/thread-sidebar', '@dshfiles/memory', '@dshfiles/shared-runtime'],
    upToDate: false,
    commands: [command],
    files: [{ path: `${home}/profiles/main/package.json`, change: 'new profile file' }],
  },
  problem: null,
  marker: { path: `${home}/profiles/main/dshfiles-setup.json`, packs: ['core', 'knowledge'] },
  unbuilt: [],
  buildCommand: null,
  startCommand: 'dsh --profile main web',
  titles: {
    '@dshfiles/thread-sidebar': 'Organize threads by workspace and status',
    '@dshfiles/memory': 'Browse and clean up memory',
    '@dshfiles/shared-runtime': 'Share the client UI runtime',
  },
  hash: 'h',
}

const render = (): string =>
  renderToStaticMarkup(
    <ReviewScreen review={{ kind: 'plan', result }} packs={packs} dshHome={home} onBack={() => undefined} onApply={() => undefined} onSkip={() => undefined} />,
  )

describe('Review screen', () => {
  it('leads with one sentence and the packs, the supplier grouped quietly', () => {
    const html = render()
    expect(html).toContain('Creates the main profile with 2 packs, 3 plugins.')
    expect(html).toContain('Memory across threads.')
    expect(html).toContain('Needed by another plugin')
    expect(html).toContain('+1')
  })

  it('names the DSH home once and every file relative to it', () => {
    const html = render()
    expect(html.split(home).length - 1).toBe(1)
    expect(html).toContain('profiles/main/package.json')
    expect(html).toContain('profiles/main/dshfiles-setup.json')
  })

  it('keeps package ids, plugin lists and the command behind their disclosures until opened', () => {
    const html = render()
    expect(html).not.toContain('@dshfiles/')
    expect(html).not.toContain('Organize threads by workspace and status')
    expect(html).not.toContain('profile-sync')
    expect(html).toContain('Show details')
  })
})
