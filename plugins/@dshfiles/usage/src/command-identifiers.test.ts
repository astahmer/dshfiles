import { describe, expect, it } from 'vitest'
import { identifyCommand } from './command-identifiers.js'

const shellCall = (command: string, toolName = 'bash') => identifyCommand({ toolName, arguments: JSON.stringify({ command }) })

describe('identifyCommand', () => {
  it('normalizes executable and subcommand without preserving paths or arguments', () => {
    expect(shellCall('cd "/Users/private/repo" && pnpm --dir "/Users/private/repo" run test:e2e -- secret=hidden')).toEqual({
      normalizedCommand: 'pnpm test:e2e',
      testRunner: 'pnpm:test:e2e',
    })
  })

  it('identifies test runners behind supported wrappers', () => {
    expect(shellCall('fnm exec --using=22.23.3 pnpm --dir /private/repo exec vitest run src/secret.test.ts')).toEqual({
      normalizedCommand: 'vitest',
      testRunner: 'vitest',
    })
    expect(shellCall('pnpm --dir "C:\\Private Documents\\repo" run test:e2e')).toEqual({
      normalizedCommand: 'pnpm test:e2e',
      testRunner: 'pnpm:test:e2e',
    })
    expect(shellCall('pytest --password hidden')).toEqual({ normalizedCommand: 'pytest', testRunner: 'pytest' })
    expect(shellCall('pnpm test -- secret-token')).toEqual({ normalizedCommand: 'pnpm test', testRunner: 'pnpm:test' })
    expect(shellCall('env TOKEN=hidden pnpm test')).toEqual({ normalizedCommand: 'pnpm test', testRunner: 'pnpm:test' })
    expect(shellCall('env -u TOKEN pnpm test')).toEqual({ normalizedCommand: null, testRunner: null })
    expect(shellCall('node --test src/private.test.js')).toEqual({ normalizedCommand: 'node --test', testRunner: 'node-test' })
    expect(shellCall('echo "vitest"')).toEqual({ normalizedCommand: 'echo', testRunner: null })
  })

  it('omits command identifiers for compound commands and unsafe words', () => {
    expect(shellCall('pnpm test && curl -H Authorization:secret https://private.example')).toEqual({ normalizedCommand: null, testRunner: null })
    expect(shellCall('$(cat /private/secret)')).toEqual({ normalizedCommand: null, testRunner: null })
  })

  it('only inspects shell tools and bounded JSON command arguments', () => {
    expect(shellCall('pnpm test', 'some-plugin')).toEqual({ normalizedCommand: null, testRunner: null })
    expect(identifyCommand({ toolName: 'bash', arguments: '{"command":"pnpm test","token":"hidden"}' })).toEqual({
      normalizedCommand: 'pnpm test',
      testRunner: 'pnpm:test',
    })
    expect(identifyCommand({ toolName: 'bash', arguments: { command: 'vitest run src/private.spec.ts' } })).toEqual({
      normalizedCommand: 'vitest run',
      testRunner: 'vitest',
    })
    expect(identifyCommand({ toolName: 'bash', arguments: 'not json' })).toEqual({ normalizedCommand: null, testRunner: null })
    expect(identifyCommand({ toolName: 'bash', arguments: JSON.stringify({ command: 'x'.repeat(4_097) }) })).toEqual({
      normalizedCommand: null,
      testRunner: null,
    })
  })
})
