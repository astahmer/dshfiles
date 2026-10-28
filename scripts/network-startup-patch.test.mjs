import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDocument } from 'yaml'
import { networkStartupPatch } from './network-startup-patch.mjs'

const jsTag = 'tag:yaml.org,2002:js'
const parse = text => {
  const document = parseDocument(text, { customTags: [{ tag: jsTag, resolve: value => value }] })
  assert.equal(document.errors.length, 0)
  return document
}
const nativeConfig = text =>
  parse(text)
    .contents.items.find(row => row.get('id') === 'webserver')
    .get('config', true)
const original = `# profile comment
- id: before
  config:
    untouched: !!js process.env.NEVER_EVALUATE_THIS
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [otherService]
  config:
    # bind comment
    host: !!js ctx.webStartup.host ?? process.env.BIND_ADDRESS # host comment
    port: !!js ctx.webStartup.port ?? 3080 # port comment
    tls: !!js ctx.webStartup.tls
    compression: gzip
- id: after
  config: { other: true }
`

test('delegates scalar expressions with CLI first and preserves unrelated YAML and comments', () => {
  const output = networkStartupPatch(original)
  const document = parse(output)
  const config = nativeConfig(output)
  assert.equal(config.get('host', true).tag, jsTag)
  assert.equal(config.get('host'), 'ctx.webStartup.host ?? ctx.dshfilesNetworkStartup.host ?? (ctx.webStartup.host ?? process.env.BIND_ADDRESS)')
  assert.equal(config.get('port'), 'ctx.webStartup.port ?? ctx.dshfilesNetworkStartup.port ?? (ctx.webStartup.port ?? 3080)')
  assert.equal(config.get('tls', true).tag, jsTag)
  assert.equal(config.get('tls'), 'ctx.webStartup.tls')
  assert.equal(config.get('compression'), 'gzip')
  assert.deepEqual(document.contents.items[1].get('inject').toJSON(), ['otherService', 'webStartup', 'dshfilesNetworkStartup'])
  assert.match(output, /# profile comment/)
  assert.match(output, /# bind comment/)
  assert.match(output, /# host comment/)
  assert.match(output, /# port comment/)
  assert.deepEqual(document.contents.items[0].toJSON(), parse(original).contents.items[0].toJSON())
  assert.deepEqual(document.contents.items[2].toJSON(), parse(original).contents.items[2].toJSON())
})

test('preserves a literal host as a JSON string, not executable code', () => {
  const source = `- id: webserver\n  config:\n    host: '"; globalThis.pwned = true; "'\n    port: 4000\n`
  const config = nativeConfig(networkStartupPatch(source))
  assert.equal(config.get('host'), `ctx.webStartup.host ?? ctx.dshfilesNetworkStartup.host ?? (${JSON.stringify('"; globalThis.pwned = true; "')})`)
  assert.equal(config.get('port'), 'ctx.webStartup.port ?? ctx.dshfilesNetworkStartup.port ?? (4000)')
})

test('fills absent native fallback fields without adding an explicit injection override', () => {
  const output = networkStartupPatch('- id: webserver\n  config:\n    compression: gzip\n')
  const config = nativeConfig(output)
  assert.equal(config.get('host'), 'ctx.webStartup.host ?? ctx.dshfilesNetworkStartup.host ?? ("127.0.0.1")')
  assert.equal(config.get('port'), 'ctx.webStartup.port ?? ctx.dshfilesNetworkStartup.port ?? (3080)')
  assert.equal(parse(output).contents.items[0].has('inject'), false)
})

test('changes only old default ports when legacyPort is supplied', () => {
  for (const port of ['', '    port: 3080\n', '    port: !!js ctx.webStartup.port ?? 3080\n', '    port: !!js "  ctx.webStartup.port ?? 3080  "\n']) {
    const output = networkStartupPatch(`- id: webserver\n  config:\n    host: 192.0.2.10\n${port}`, { legacyPort: 3198 })
    assert.match(nativeConfig(output).get('port'), /3198/)
    assert.doesNotMatch(nativeConfig(output).get('port'), /3080/)
  }
  for (const port of [
    '    port: 0\n',
    '    port: 4000\n',
    '    port: !!js ctx.webStartup.port ?? 4000\n',
    '    port: !!js process.env.CUSTOM_PORT ?? 3080\n',
  ]) {
    const source = `- id: webserver\n  config:\n    host: 192.0.2.10\n${port}`
    const output = networkStartupPatch(source, { legacyPort: 3198 })
    assert.doesNotMatch(nativeConfig(output).get('port'), /3198/)
    assert.match(nativeConfig(output).get('port'), /\(.*\)$/)
  }
})

test('returns exact input on rerun, including when a different legacyPort is passed', () => {
  const first = networkStartupPatch(original, { legacyPort: 3198 })
  assert.equal(networkStartupPatch(first), first)
  assert.equal(networkStartupPatch(first, { legacyPort: 4000 }), first)
})

test('does not wrap an already-delegated field again during a partial migration', () => {
  const source = '- id: webserver\n  config:\n    host: !!js ctx.webStartup.host ?? ctx.dshfilesNetworkStartup.host ?? ("192.0.2.10")\n    port: 4000\n'
  const output = networkStartupPatch(source)
  assert.equal(nativeConfig(output).get('host'), nativeConfig(source).get('host'))
  assert.equal(networkStartupPatch(output), output)
})

test('does not rewrite a bundle-managed profile or a row without a config override', () => {
  for (const source of ['[]\n', '# untouched\n- id: other\n  config: {}\n', '- id: webserver\n  inject: [otherService]\n']) {
    assert.equal(networkStartupPatch(source), source)
  }
})

test('rejects protected rows and malformed managed regions', () => {
  const protectedSource = '# BEGIN NIX-MANAGED DSH PLUGINS\n- id: webserver\n  config: {host: 192.0.2.10, port: 3080}\n# END NIX-MANAGED DSH PLUGINS\n'
  assert.throws(() => networkStartupPatch(protectedSource), /Nix-managed/)
  assert.throws(() => networkStartupPatch('# BEGIN NIX-MANAGED DSH PLUGINS\n[]\n'), /Unclosed/)
  assert.throws(() => networkStartupPatch('# END NIX-MANAGED DSH PLUGINS\n[]\n'), /Unmatched/)
})

test('allows a webserver override outside a protected region and preserves that region', () => {
  const source =
    '# BEGIN NIX-MANAGED DSH PLUGINS\n- id: other\n  config: {value: 1}\n# END NIX-MANAGED DSH PLUGINS\n- id: webserver\n  config: {host: 192.0.2.10, port: 4000}\n'
  const output = networkStartupPatch(source)
  assert.match(output, /# BEGIN NIX-MANAGED DSH PLUGINS/)
  assert.match(output, /# END NIX-MANAGED DSH PLUGINS/)
  assert.equal(parse(output).contents.items[0].get('config').get('value'), 1)
})

test('rejects whole-config expressions, aliases, field collections and unknown tags', () => {
  for (const config of [
    '!!js "({host: \'192.0.2.10\', port: 4000})"',
    '[192.0.2.10, 4000]',
    '{host: [192.0.2.10], port: 4000}',
    '{host: {address: 192.0.2.10}, port: 4000}',
    '{host: !custom 192.0.2.10, port: 4000}',
  ]) {
    assert.throws(() => networkStartupPatch(`- id: webserver\n  config: ${config}\n`), /mapping|scalar|unsupported/)
  }
  assert.throws(() => networkStartupPatch('- id: other\n  config: &shared {host: 192.0.2.10, port: 4000}\n- id: webserver\n  config: *shared\n'), /mapping/)
})

test('rejects duplicate native rows, non-native row names and malformed YAML', () => {
  assert.throws(() => networkStartupPatch('- id: webserver\n  config: {}\n- id: webserver\n'), /duplicate webserver/)
  assert.throws(() => networkStartupPatch('- id: webserver\n  name: custom-server\n  config: {}\n'), /native WebServer/)
  assert.throws(() => networkStartupPatch('not: a-sequence\n'), /YAML sequence/)
  assert.throws(() => networkStartupPatch('- id: webserver\n  config: [\n'))
})

test('rejects unsupported injection shapes and does not duplicate existing strings', () => {
  for (const injection of ['!!js "[\'webStartup\']"', '{webStartup: true}', '[webStartup, 1]', '[!!js ctx.serviceName]']) {
    assert.throws(() => networkStartupPatch(`- id: webserver\n  inject: ${injection}\n  config: {}\n`), /array of plain service-name strings/)
  }
  const output = networkStartupPatch('- id: webserver\n  inject: [webStartup, dshfilesNetworkStartup, extra]\n  config: {}\n')
  assert.deepEqual(parse(output).contents.items[0].get('inject').toJSON(), ['webStartup', 'dshfilesNetworkStartup', 'extra'])
})

test('keeps multiline expressions and trailing JavaScript comments inside the wrapper', () => {
  const source = '- id: webserver\n  config:\n    host: !!js |-\n      process.env.BIND_ADDRESS // preserved JS comment\n    port: 4000\n'
  const output = networkStartupPatch(source)
  assert.equal(
    nativeConfig(output).get('host'),
    'ctx.webStartup.host ?? ctx.dshfilesNetworkStartup.host ?? (process.env.BIND_ADDRESS // preserved JS comment\n)',
  )
  assert.equal(networkStartupPatch(output), output)
})

test('rejects anchored edited nodes rather than changing aliases elsewhere', () => {
  for (const source of [
    '- id: webserver\n  config: &shared {host: 192.0.2.10, port: 4000}\n',
    '- id: webserver\n  config:\n    host: &shared 192.0.2.10\n    port: 4000\n',
    '- id: webserver\n  inject: &shared [webStartup]\n  config: {}\n',
  ])
    assert.throws(() => networkStartupPatch(source), /unanchored|array of plain/)
})

test('rejects invalid literal field types and invalid legacy ports', () => {
  for (const config of [
    '{host: null, port: 4000}',
    '{host: false, port: 4000}',
    '{host: 192.0.2.10, port: null}',
    '{host: 192.0.2.10, port: "3080"}',
    '{host: 192.0.2.10, port: 65536}',
  ]) {
    assert.throws(() => networkStartupPatch(`- id: webserver\n  config: ${config}\n`))
  }
  for (const legacyPort of [-1, 65536, 1.5, '3198']) assert.throws(() => networkStartupPatch('[]\n', { legacyPort }), /legacyPort/)
})

const runtimeConfig = text =>
  parse(text)
    .contents.items.find(row => row.get('id') === 'web-runtime')
    .get('config', true)
const runtimeOverride = `# runtime comment
- id: web-runtime
  name: '@deepseek-ai/dsh-web-app'
  inject: [webStartup, customService]
  config:
    openBrowser: !!js ctx.webStartup.openBrowser ?? process.env.CUSTOM_BROWSER
    # printing comment
    printUrl: true # trailing print comment
    publicUrl: !!js ctx.webStartup.publicUrl ?? 'https://proxy.example.invalid/ui/'
    surfaceContext: false
    futureField: { keep: unchanged }
`

test('suppresses only native runtime printing while preserving configured fields and expressions', () => {
  const output = networkStartupPatch(runtimeOverride)
  const before = runtimeConfig(runtimeOverride)
  const after = runtimeConfig(output)
  assert.equal(after.get('printUrl'), false)
  for (const field of ['openBrowser', 'publicUrl', 'surfaceContext', 'futureField']) {
    assert.deepEqual(after.get(field, true).toJSON(), before.get(field, true).toJSON())
    assert.equal(after.get(field, true).tag, before.get(field, true).tag)
  }
  assert.deepEqual(parse(output).contents.items[0].get('inject').toJSON(), ['webStartup', 'customService'])
  assert.match(output, /# runtime comment/)
  assert.match(output, /# printing comment/)
  assert.match(output, /# trailing print comment/)
  assert.equal(networkStartupPatch(output), output)
})

test('migrates runtime printing even when the binding row is already delegated', () => {
  const binding = networkStartupPatch(original)
  const output = networkStartupPatch(binding + runtimeOverride)
  assert.equal(runtimeConfig(output).get('printUrl'), false)
  assert.deepEqual(nativeConfig(output).toJSON(), nativeConfig(binding).toJSON())
  assert.equal(networkStartupPatch(output), output)
})

test('adds suppression to an explicit runtime config lacking printUrl without replacing it', () => {
  const output = networkStartupPatch('- id: web-runtime\n  config: {openBrowser: false, surfaceContext: false}\n')
  assert.deepEqual(runtimeConfig(output).toJSON(), { openBrowser: false, surfaceContext: false, printUrl: false })
})

test('leaves absent runtime overrides and already-false print policy byte-for-byte unchanged', () => {
  for (const source of [
    '[]\n',
    '- id: web-runtime\n  inject: [webStartup]\n',
    '- id: web-runtime\n  config: {printUrl: false, surfaceContext: false} # preserve\n',
  ]) {
    assert.equal(networkStartupPatch(source), source)
  }
})

test('rejects duplicate runtime rows, non-native name guards and protected runtime overrides', () => {
  assert.throws(() => networkStartupPatch('- id: web-runtime\n  config: {}\n- id: web-runtime\n'), /duplicate web-runtime/)
  assert.throws(() => networkStartupPatch('- id: web-runtime\n  name: custom-runtime\n  config: {}\n'), /native Web app/)
  assert.throws(
    () => networkStartupPatch('# BEGIN NIX-MANAGED DSH PLUGINS\n- id: web-runtime\n  config: {printUrl: true}\n# END NIX-MANAGED DSH PLUGINS\n'),
    /Nix-managed/,
  )
})

test('rejects ambiguous runtime mappings, aliases and edited scalars without evaluating expressions', () => {
  for (const config of [
    '!!js "({printUrl: true})"',
    '[true]',
    '&shared {printUrl: true}',
    '{printUrl: &shared true}',
    '{printUrl: !!js process.env.NEVER_EVALUATE_THIS}',
    '{printUrl: "true"}',
    '{printUrl: [true]}',
    '{printUrl: !custom true}',
    '{<<: {printUrl: true}}',
  ]) {
    assert.throws(() => networkStartupPatch(`- id: web-runtime\n  config: ${config}\n`), /mapping|boolean literal/)
  }
  assert.throws(() => networkStartupPatch('- id: before\n  config: &shared {printUrl: true}\n- id: web-runtime\n  config: *shared\n'), /mapping/)
  assert.throws(() => networkStartupPatch('- &shared\n  id: web-runtime\n  config: {printUrl: true}\n'), /mapping/)
})
