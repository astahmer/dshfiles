import { describe, expect, it } from 'vitest'
import { GithubMapping } from './sync-github.js'
import { GithubRemotes } from './sync-local-probes.js'
import { BacklogSyncModel } from './sync-model.js'

describe('GithubRemotes.repositoryOfUrl', () => {
  it.each([
    ['git@github.com:acme/app.git', 'acme/app'],
    ['https://github.com/acme/app', 'acme/app'],
    ['https://github.com/acme/app.git', 'acme/app'],
    ['https://token@github.com/acme/my.app.git', 'acme/my.app'],
    ['ssh://git@github.com/acme/app.git', 'acme/app'],
    ['ssh://git@github.com:22/acme/app', 'acme/app'],
  ])('reads %s as %s', (url, repository) => {
    expect(GithubRemotes.repositoryOfUrl(url)).toBe(repository)
  })

  it.each(['https://gitlab.com/acme/app.git', 'ssh://m1/Users/me/repo.git', 'git@github.com:acme', 'https://github.com/acme/app/issues/1'])(
    'ignores %s',
    url => {
      expect(GithubRemotes.repositoryOfUrl(url)).toBeUndefined()
    },
  )
})

describe('GithubRemotes.repositoryOfRemotes', () => {
  it('prefers origin, then upstream, then the first github.com remote', () => {
    expect(GithubRemotes.repositoryOfRemotes('fork https://github.com/me/app\norigin git@github.com:acme/app.git\n')).toBe('acme/app')
    expect(GithubRemotes.repositoryOfRemotes('fork https://github.com/me/app\nupstream https://github.com/acme/app\n')).toBe('acme/app')
    expect(GithubRemotes.repositoryOfRemotes('peer ssh://m1/repo.git\nfork https://github.com/me/app\n')).toBe('me/app')
    expect(GithubRemotes.repositoryOfRemotes('origin https://gitlab.com/acme/app\n')).toBeUndefined()
    expect(GithubRemotes.repositoryOfRemotes('')).toBeUndefined()
  })
})

describe('BacklogSyncModel.backendOfReference', () => {
  it.each([
    ['ENG-12', 'linear'],
    ['https://linear.app/acme/issue/ENG-12/slug', 'linear'],
    ['42', 'github'],
    ['#42', 'github'],
    ['acme/app#42', 'github'],
    ['https://github.com/acme/app/issues/42', 'github'],
    ['  ENG-12  ', 'linear'],
  ])('reads %s as %s', (reference, backend) => {
    expect(BacklogSyncModel.backendOfReference(reference)).toBe(backend)
  })

  it.each(['', 'fix the bug', 'https://example.com/issue/1'])('names no tracker for %j', reference => {
    expect(BacklogSyncModel.backendOfReference(reference)).toBeUndefined()
  })
})

describe('GithubMapping.repositoryOfReference', () => {
  it('reads the repository a reference names', () => {
    expect(GithubMapping.repositoryOfReference('acme/app#3')).toBe('acme/app')
    expect(GithubMapping.repositoryOfReference('https://github.com/acme/app/issues/3')).toBe('acme/app')
    expect(GithubMapping.repositoryOfReference('#3')).toBeUndefined()
  })
})
