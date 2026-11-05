import { describe, expect, it } from 'vitest'
import { CapabilitiesHub } from './hub-model.js'

describe('CapabilitiesHub model', () => {
  it('routes each kind to its own manager with a distinct trust label', () => {
    const sections = CapabilitiesHub.overview().sections
    expect(sections.map(section => [section.id, section.manager.panelId, section.trust])).toEqual([
      ['skills', 'dshfiles-agent-toolkit', 'agent-instructions'],
      ['mcp', 'mcp-servers', 'tools-and-credentials'],
      ['plugins', 'plugins', 'executable-code'],
    ])
    expect(new Set(sections.map(section => section.trustLabel)).size).toBe(3)
  })

  it('keeps skills.sh as a link-out with a pinned, telemetry-off command', () => {
    const guidance = CapabilitiesHub.skillsSh
    expect(guidance.inAppSearch).toBe('unavailable')
    expect(guidance.command).toMatch(/^DISABLE_TELEMETRY=1 npx skills@\d+\.\d+\.\d+ add /u)
    expect(guidance.command).toContain(guidance.cliVersion)
    expect(guidance.url).toBe('https://skills.sh')
  })

  it('counts skills by where they come from and leaves empty groups out', () => {
    expect(
      CapabilitiesHub.skillCounts([
        { source: 'project-agents', provider: '' },
        { source: 'project-dsh', provider: '' },
        { source: 'user-agents', provider: '' },
        { source: 'bundled', provider: '@dshfiles/memory' },
      ]),
    ).toEqual([
      { group: 'project', count: 2 },
      { group: 'user', count: 1 },
      { group: 'plugin', count: 1 },
    ])
  })

  it('renders one line per kind and the skills.sh guidance for the agent tool', () => {
    const text = CapabilitiesHub.render(CapabilitiesHub.overview())
    expect(text).toContain('MCP servers · Tools and credentials · managed by MCP servers (@dshfiles/mcp-servers)')
    expect(text).toContain('run by the user only: DISABLE_TELEMETRY=1 npx skills@')
  })
})
