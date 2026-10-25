import { describe, expect, it } from 'vitest'
import { satisfies } from 'semver'
import {
  analyzeDeclaredDshRange,
  assessProjectCompatibility,
  classifyCompatibility,
  getCompatibilityCapabilities,
  getCompatibilitySmokeMatrix,
  projectCompatibilityDiagnostics,
  resolveCompatibility,
  resolveDeclaredCompatibility,
  projectHostProvidedDependencyDiagnostics,
} from '../src/compat/index.js'
import { PROTOCOL_2_COMPATIBILITY } from '../src/compat/protocol-2.js'
import type { DshCompatibility } from '../src/compat/types.js'

const LEGACY_COMPATIBILITY: DshCompatibility = {
  ...PROTOCOL_2_COMPATIBILITY,
  id: 'protocol-legacy',
  protocolGeneration: 'protocol-legacy',
  lifecycle: 'end-of-life',
  version: '0.1.0',
  dshRange: '>=0.1.0 <0.2.0-0',
  verified: { minimum: '0.1.0', latest: '0.1.0' },
  verifiedVersions: ['0.1.0'],
}

describe('DSH protocol compatibility generations', () => {
  it('pins the official implicit module table baseline', () => {
    expect(PROTOCOL_2_COMPATIBILITY.client.platformModules).toEqual([
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
    ])
    expect(PROTOCOL_2_COMPATIBILITY.client.preloadedExternals).toEqual(['@deepseek-ai/dsh-client-connection/client'])
    expect(PROTOCOL_2_COMPATIBILITY.hostContributions).toEqual({ commands: true, promptSections: true, promptContexts: true, settings: true })
    expect(PROTOCOL_2_COMPATIBILITY.client.conversation).toEqual({
      runtimePackageName: '@deepseek-ai/dsh-client-ui-conversation',
      rendererPackageName: '@deepseek-ai/dsh-client-ui-conversation',
      slotService: 'slots',
      componentContributions: false,
      verification: 'experimental',
    })
    expect(PROTOCOL_2_COMPATIBILITY.session).toEqual({ customDurableEventVocabulary: false })
    const capabilities = getCompatibilityCapabilities(PROTOCOL_2_COMPATIBILITY)
    expect(capabilities).toEqual(
      expect.arrayContaining([
        'host:commands',
        'host:prompt-sections',
        'host:prompt-contexts',
        'host:settings',
        'client:config-forms',
        'client:settings-hook-inference',
        'client:conversation-chat-slots',
        'client:api-hook-inference',
        'session:custom-durable-event-vocabulary:unavailable',
      ]),
    )
    expect(capabilities).not.toContain('client:conversation-components:experimental')
  })

  it('distinguishes verified, compatible, and experimental versions in one generation', () => {
    expect(classifyCompatibility('0.2.0-rc.2')).toMatchObject({ compatibility: PROTOCOL_2_COMPATIBILITY, support: 'verified' })
    expect(resolveCompatibility('0.2.0-rc.3')).toBe(PROTOCOL_2_COMPATIBILITY)
    expect(classifyCompatibility('0.2.1')).toMatchObject({ compatibility: PROTOCOL_2_COMPATIBILITY, support: 'compatible' })
    expect(classifyCompatibility('0.2.0-rc.3')).toMatchObject({ compatibility: PROTOCOL_2_COMPATIBILITY, support: 'experimental' })
  })

  it('publishes a peer range accepted by package managers for every verified prerelease', () => {
    for (const version of PROTOCOL_2_COMPATIBILITY.verifiedVersions) {
      expect(satisfies(version, PROTOCOL_2_COMPATIBILITY.dshRange)).toBe(true)
    }
  })

  it('rejects a DSH version outside every supported protocol generation', () => {
    expect(() => resolveCompatibility('0.3.0')).toThrow('DSHX5101')
    expect(classifyCompatibility('0.3.0')).toBeUndefined()
    expect(classifyCompatibility('0.3.0-rc.1')).toBeUndefined()
  })

  it('rejects a DSH version from a retired protocol generation', () => {
    expect(() => resolveCompatibility('0.1.1-rc.2')).toThrow('DSHX5101')
    expect(classifyCompatibility('0.1.0-rc.8')).toBeUndefined()
  })

  it('uses peerDependencies for public support and keeps devDependencies independent', () => {
    const manifest = {
      devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2', '@dshfiles/dshx': '9.4.0' },
      peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0-rc.1 <0.3.0-0' },
    }
    expect(resolveDeclaredCompatibility(manifest)).toMatchObject({ compatibility: PROTOCOL_2_COMPATIBILITY, support: 'compatible' })
    expect(resolveDeclaredCompatibility({ devDependencies: manifest.devDependencies })).toBeUndefined()
    expect(assessProjectCompatibility(manifest, '0.2.0-rc.1')).toMatchObject({
      declaredRange: '>=0.2.0-rc.1 <0.3.0-0',
      developmentSpecifier: '0.2.0-rc.2',
      installedVersion: '0.2.0-rc.1',
      installedWithinDeclaredRange: true,
      compatibility: PROTOCOL_2_COMPATIBILITY,
      resolution: { support: 'verified' },
    })
  })

  it('models a single artifact as exactly one protocol generation', () => {
    const adapters = [LEGACY_COMPATIBILITY, PROTOCOL_2_COMPATIBILITY]
    expect(analyzeDeclaredDshRange('>=0.2.0-rc.1 <0.3.0-0', adapters)).toMatchObject({
      status: 'single-generation',
      compatibility: PROTOCOL_2_COMPATIBILITY,
    })
    expect(analyzeDeclaredDshRange('>=0.1.0 <0.3.0-0', adapters)).toMatchObject({
      status: 'spans-generations',
      compatibilities: [LEGACY_COMPATIBILITY, PROTOCOL_2_COMPATIBILITY],
    })
    expect(analyzeDeclaredDshRange('>=0.1.0 <0.3.0-0', [PROTOCOL_2_COMPATIBILITY])).toMatchObject({
      status: 'partially-supported',
      compatibility: PROTOCOL_2_COMPATIBILITY,
    })
    expect(analyzeDeclaredDshRange('^9.0.0', adapters)).toMatchObject({ status: 'unsupported' })
    expect(analyzeDeclaredDshRange('not semver', adapters)).toMatchObject({ status: 'invalid' })
  })

  it('diagnoses a local DSH version outside the plugin public range', () => {
    const assessment = assessProjectCompatibility(
      {
        devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' },
        peerDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.1' },
      },
      '0.2.0-rc.2',
    )
    expect(projectCompatibilityDiagnostics(assessment, '/plugin/package.json')).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DSHX5108', severity: 'error' })]),
    )
  })

  it('derives representative real-smoke boundaries from the adapter registry', () => {
    expect(getCompatibilitySmokeMatrix()).toEqual([
      { generation: 'protocol-2', adapterId: 'protocol-2', role: 'minimum', version: '0.2.0-rc.1' },
      { generation: 'protocol-2', adapterId: 'protocol-2', role: 'latest', version: '0.2.0-rc.2' },
    ])
  })
})

describe('projectHostProvidedDependencyDiagnostics', () => {
  it('refuses a Host-provided package in dependencies with its own code', () => {
    const diagnostics = projectHostProvidedDependencyDiagnostics(
      { dependencies: { '@deepseek-ai/dsh-llm': '0.2.0-rc.2', '@deepseek-ai/schemastery': '^3.18.4', zod: '^4.4.3' } },
      '/plugin/package.json',
    )
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'DSHX5110', severity: 'error', message: expect.stringContaining('"@deepseek-ai/dsh-llm"') })])
    expect(projectHostProvidedDependencyDiagnostics({ dependencies: { zod: '^4.4.3' } }, '/plugin/package.json')).toEqual([])
  })
})
