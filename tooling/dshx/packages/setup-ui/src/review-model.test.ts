import { describe, expect, it } from 'vitest'
import type { InitPlan, SetupPack, SetupPlanResult } from './api.js'
import { ReviewModel } from './review-model.js'

const home = '/tmp/home'
const packs: readonly SetupPack[] = [
  { id: 'core', title: 'Core', summary: 'The shell.', core: true, plugins: ['thread-sidebar', 'ai-accounts'] },
  { id: 'accounts', title: 'Accounts & cost', summary: 'Several accounts.', core: false, plugins: ['ai-accounts', 'usage'] },
  { id: 'knowledge', title: 'Knowledge', summary: 'Memory.', core: false, plugins: ['memory'] },
]
const plan: InitPlan = {
  profile: 'main',
  profileRoot: `${home}/profiles/main`,
  packs: [
    { id: 'core', title: 'Core' },
    { id: 'accounts', title: 'Accounts & cost' },
  ],
  plugins: ['@dshfiles/thread-sidebar', '@dshfiles/ai-accounts', '@dshfiles/usage', '@dshfiles/shared-runtime'],
  suppliers: ['@dshfiles/shared-runtime'],
  kept: [],
  created: true,
  linked: ['@dshfiles/thread-sidebar', '@dshfiles/ai-accounts', '@dshfiles/usage', '@dshfiles/shared-runtime'],
  upToDate: false,
  commands: ['node scripts/profile-sync.ts --profile main'],
  files: [
    { path: `${home}/profiles/main/package.json`, change: 'new profile file' },
    { path: `${home}/profiles/main/node_modules`, change: 'pnpm install' },
  ],
}
const titles = {
  '@dshfiles/thread-sidebar': 'Organize threads by workspace and status',
  '@dshfiles/ai-accounts': 'Manage provider account drafts',
  '@dshfiles/usage': 'Request log',
  '@dshfiles/shared-runtime': 'Share the client UI runtime',
}

describe('review grouping', () => {
  it('lists each planned plugin once, under the first chosen pack that names it, by its title', () => {
    const groups = ReviewModel.groups({ plan, packs, titles })
    expect(groups.packs.map(pack => [pack.title, pack.plugins.map(plugin => plugin.title)])).toEqual([
      ['Core', ['Organize threads by workspace and status', 'Manage provider account drafts']],
      ['Accounts & cost', ['Request log']],
    ])
    expect(groups.packs[1]?.summary).toBe('Several accounts.')
  })

  it('groups the plugins another plugin needs apart from the packs, and keeps the profile’s others', () => {
    const groups = ReviewModel.groups({ plan: { ...plan, kept: ['@dshfiles/backlog'] }, packs, titles })
    expect(groups.needed).toEqual([{ name: '@dshfiles/shared-runtime', title: 'Share the client UI runtime' }])
    expect(groups.kept).toEqual([{ name: '@dshfiles/backlog', title: 'backlog' }])
  })

  it('leads with one sentence for a new, an updated and an unchanged profile', () => {
    expect(ReviewModel.summary(plan)).toBe('Creates the main profile with 2 packs, 4 plugins.')
    expect(ReviewModel.summary({ ...plan, created: false, linked: ['@dshfiles/usage'] })).toBe('Adds 1 plugin to the main profile, for 2 packs.')
    expect(ReviewModel.summary({ ...plan, created: false, upToDate: true })).toBe('The main profile already has these 2 packs, 4 plugins.')
  })

  it('names files relative to the DSH home, in words, with the setup marker last', () => {
    const result: SetupPlanResult = {
      plan,
      problem: null,
      marker: { path: `${home}/profiles/main/dshfiles-setup.json`, packs: ['core', 'accounts'] },
      unbuilt: [],
      buildCommand: null,
      startCommand: 'dsh --profile main web',
      titles,
      hash: 'h',
    }
    expect(ReviewModel.files({ result, dshHome: home })).toEqual([
      { path: 'profiles/main/package.json', change: 'New file' },
      { path: 'profiles/main/node_modules', change: 'Installs the plugins' },
      { path: 'profiles/main/dshfiles-setup.json', change: 'Remembers the packs you chose' },
    ])
    expect(ReviewModel.files({ result, dshHome: '/elsewhere' })[0]?.path).toBe(`${home}/profiles/main/package.json`)
  })
})
