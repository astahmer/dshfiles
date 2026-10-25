import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PluginScreenshots } from './plugin-screenshots-core.mjs'

const feature = (id, surfaces = ['client'], reach) => {
  const feature = {
    id,
    title: id,
    summary: id,
    surfaces,
    configuration: [],
    states: ['one'],
    failureModes: ['none'],
    externalDependencies: [],
    verification: [{ kind: 'gherkin', id: `x.${id}`, featureFile: 'tooling/dshx/e2e/features/x.feature' }],
  }
  if (reach !== undefined) feature.reach = reach
  return feature
}

const catalog = (kind, features) => ({ schemaVersion: 1, kind, features })
const walk = ['click button "Settings"']

describe('UI plugin classification', () => {
  it('gates a bundle that renders a client surface, not a library or a Host-only bundle', () => {
    assert.equal(PluginScreenshots.isUiBundle(catalog('bundle', [feature('a')])), true)
    assert.equal(PluginScreenshots.isUiBundle(catalog('bundle', [feature('a', ['host'])])), false)
    assert.equal(PluginScreenshots.isUiBundle(catalog('library', [feature('a')])), false)
    assert.equal(PluginScreenshots.isUiBundle(catalog('infrastructure', [feature('a')])), false)
  })

  it('keeps the bundles whose ignore entry explains why they render nothing', () => {
    const catalogs = [
      { name: 'zeta', directory: '/p/zeta', catalog: catalog('bundle', [feature('a', ['client'], walk)]) },
      { name: 'alpha', directory: '/p/alpha', catalog: catalog('bundle', [feature('b', ['client'], walk)]) },
      { name: 'styles', directory: '/p/styles', catalog: catalog('bundle', [feature('c')]) },
      { name: 'kit', directory: '/p/kit', catalog: catalog('library', [feature('d')]) },
    ]
    const gated = PluginScreenshots.gatedPlugins({ catalogs, ignored: { styles: 'compiles the shared sheet, so it has no screen of its own' } })
    assert.deepEqual(
      gated.map(plugin => plugin.name),
      ['alpha', 'zeta'],
    )
    assert.deepEqual(
      gated.map(plugin => plugin.reachable.length),
      [1, 1],
    )
  })

  it('counts only features whose reach has steps', () => {
    const parsed = catalog('bundle', [feature('a', ['client'], []), feature('b'), feature('c', ['client'], walk)])
    assert.deepEqual(
      PluginScreenshots.reachableFeatures(parsed).map(candidate => candidate.id),
      ['c'],
    )
  })
})

describe('screenshot problems', () => {
  const screenshot = (file, bytes = 60_000) => ({ directory: 'docs/screenshots', file, bytes })

  it('asks for a screenshot, naming a missing reach path when that is the blocker', () => {
    assert.deepEqual(PluginScreenshots.screenshotProblems({ reachable: 1, screenshots: [], readme: '# x\n', sizeLimitBytes: 1 }), ['no screenshot'])
    assert.deepEqual(PluginScreenshots.screenshotProblems({ reachable: 0, screenshots: [], readme: '# x\n', sizeLimitBytes: 1 }), [
      'no screenshot (catalog has no reach steps to capture)',
    ])
  })

  it('requires every capture to be embedded in the README', () => {
    const readme = '# x\n\n![one](docs/screenshots/one.png)\n'
    assert.deepEqual(PluginScreenshots.screenshotProblems({ reachable: 1, screenshots: [screenshot('one.png')], readme, sizeLimitBytes: 1_000_000 }), [])
    assert.deepEqual(PluginScreenshots.screenshotProblems({ reachable: 1, screenshots: [screenshot('two.png')], readme, sizeLimitBytes: 1_000_000 }), [
      'docs/screenshots/two.png not embedded in README',
    ])
    assert.deepEqual(
      PluginScreenshots.screenshotProblems({ reachable: 1, screenshots: [screenshot('one.png')], readme: undefined, sizeLimitBytes: 1_000_000 }),
      ['no README'],
    )
  })

  it('fails a capture over the size limit', () => {
    const readme = '# x\n\n![one](docs/screenshots/one.png)\n'
    assert.deepEqual(
      PluginScreenshots.screenshotProblems({ reachable: 1, screenshots: [screenshot('one.png', 2_000_000)], readme, sizeLimitBytes: 1_000_000 }),
      ['one.png 1953 KB over 1 MB'],
    )
  })
})

describe('embedding a capture', () => {
  it('puts it under the title, before the prose', () => {
    assert.equal(
      PluginScreenshots.embedScreenshot({ readme: '# Plugin\n\nWhat it does.\n', imagePath: 'docs/screenshots/a.png', alt: 'A screen' }),
      '# Plugin\n\n![A screen](docs/screenshots/a.png)\n\nWhat it does.\n',
    )
  })

  it('leaves a README that already embeds it untouched', () => {
    const readme = '# Plugin\n\n![A screen](docs/screenshots/a.png)\n\nWhat it does.\n'
    assert.equal(PluginScreenshots.embedScreenshot({ readme, imagePath: 'docs/screenshots/a.png', alt: 'A screen' }), readme)
  })
})

describe('missing screenshot selection', () => {
  it('selects only UI plugins without an existing screenshot', () => {
    const plugins = [{ name: 'already-covered' }, { name: 'needs-capture' }]
    assert.deepEqual(
      PluginScreenshots.missingScreenshotPlugins({ plugins, screenshotsOf: plugin => (plugin.name === 'already-covered' ? ['capture.png'] : []) }),
      [{ name: 'needs-capture' }],
    )
  })
})

describe('capture targets', () => {
  const one = catalog('bundle', [feature('first', ['client'], walk), feature('second', ['client'], walk), feature('host-only', ['host'])])
  const none = catalog('bundle', [feature('host-only', ['host'])])

  it('prefers the named feature, then the plugin picks, then the first reachable one', () => {
    assert.deepEqual(PluginScreenshots.targetFeatures({ catalog: one, picked: ['second'] }), ['second'])
    assert.deepEqual(PluginScreenshots.targetFeatures({ catalog: one, picked: [], primary: ['second'] }), ['second'])
    assert.deepEqual(PluginScreenshots.targetFeatures({ catalog: one, picked: [] }), ['first'])
    assert.deepEqual(PluginScreenshots.targetFeatures({ catalog: none, picked: [] }), [])
  })

  it('ignores a pick that is not a reachable feature of this plugin', () => {
    assert.deepEqual(PluginScreenshots.targetFeatures({ catalog: one, picked: ['host-only', 'first'] }), ['first'])
    assert.deepEqual(PluginScreenshots.targetFeatures({ catalog: one, picked: ['host-only'], primary: ['second'] }), ['second'])
  })
})
