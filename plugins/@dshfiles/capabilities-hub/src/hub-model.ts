/**
 * The Capabilities hub is a launchpad, not a store: every fact here is static routing (which page owns which kind of
 * capability, what trust it grants) plus counts the page reads read-only from each owner's public API. Nothing in this
 * file installs, edits or calls the network.
 */

export type HubSectionId = 'skills' | 'mcp' | 'plugins'

/** What adding one of these grants, so the three kinds are never presented as the same risk. */
export type TrustLevel = 'agent-instructions' | 'tools-and-credentials' | 'executable-code'

export interface HubManager {
  /** The `main` panel key the owner registers; the hub only selects it. */
  readonly panelId: string
  readonly label: string
  /** Package that owns the page, its state and its install flow. */
  readonly owner: string
}

export interface HubSection {
  readonly id: HubSectionId
  readonly label: string
  readonly summary: string
  readonly trust: TrustLevel
  readonly trustLabel: string
  readonly trustDetail: string
  readonly manager: HubManager
  /** Agent tools the owner serves for this kind, so an Agent goes to the owner rather than through the hub. */
  readonly agentTools: readonly string[]
}

export interface SkillsShGuidance {
  readonly url: string
  readonly docsUrl: string
  /** Pinned CLI version the command names; the hub never runs it. */
  readonly cliVersion: string
  readonly command: string
  readonly telemetryDisabled: true
  /** In-app search stays off until skills.sh offers a supported authenticated catalog contract. */
  readonly inAppSearch: 'unavailable'
  readonly inAppSearchReason: string
}

export interface HubOverview {
  readonly sections: readonly HubSection[]
  readonly skillsSh: SkillsShGuidance
}

/** Checked against `npm view skills version` on 2026-11-05; bump deliberately after reading the CLI release. */
export const SKILLS_CLI_VERSION = '1.7.6'

const SECTIONS: readonly HubSection[] = [
  {
    id: 'skills',
    label: 'Skills',
    summary: 'Instructions agents load on demand, from this project, your home folder or a plugin.',
    trust: 'agent-instructions',
    trustLabel: 'Agent instructions',
    trustDetail: 'A skill is text an agent follows. Read a skill from an unknown source before adding it; it can steer what the agent does.',
    manager: { panelId: 'dshfiles-agent-toolkit', label: 'Agent toolkit', owner: '@dshfiles/agent-toolkit' },
    agentTools: ['skill'],
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    summary: 'Tool servers agents connect to, with their credentials and connection state.',
    trust: 'tools-and-credentials',
    trustLabel: 'Tools and credentials',
    trustDetail: 'An MCP server gives agents new tools and may hold an OAuth grant or secret references. Its manager owns every credential.',
    manager: { panelId: 'mcp-servers', label: 'MCP servers', owner: '@dshfiles/mcp-servers' },
    agentTools: ['mcp_list_servers', 'mcp_search_registry', 'mcp_save_server'],
  },
  {
    id: 'plugins',
    label: 'DSH plugins',
    summary: 'Installed plugins and the marketplace that adds more.',
    trust: 'executable-code',
    trustLabel: 'Executable code',
    trustDetail: 'A DSH plugin runs code in the Host and in this browser. Install only plugins you trust; the Plugins page owns installs and updates.',
    manager: { panelId: 'plugins', label: 'Plugins', owner: 'DSH core (marketplace tab from dshmarket)' },
    agentTools: [],
  },
]

const SKILLS_SH: SkillsShGuidance = {
  url: 'https://skills.sh',
  docsUrl: 'https://www.skills.sh/docs/cli',
  cliVersion: SKILLS_CLI_VERSION,
  command: `DISABLE_TELEMETRY=1 npx skills@${SKILLS_CLI_VERSION} add <owner>/<repository>`,
  telemetryDisabled: true,
  inAppSearch: 'unavailable',
  inAppSearchReason:
    'skills.sh search needs a Vercel OIDC login that DSH cannot hold safely yet, so search runs on skills.sh. Copy the command, check the repository, then run it in a terminal yourself.',
}

/** Where a registry skill comes from, grouped the way the hub counts them. */
export type SkillGroup = 'project' | 'user' | 'plugin' | 'other'

export interface SkillCount {
  readonly group: SkillGroup
  readonly count: number
}

const groupOf = (source: string | undefined, provider: string): SkillGroup => {
  if (source?.startsWith('project-') === true) return 'project'
  if (source?.startsWith('user-') === true) return 'user'
  if (source === 'bundled' || source === 'runtime' || provider !== '') return 'plugin'
  return 'other'
}

const GROUP_ORDER: readonly SkillGroup[] = ['project', 'user', 'plugin', 'other']

export class CapabilitiesHub {
  static readonly sections = SECTIONS
  static readonly skillsSh = SKILLS_SH

  static overview(): HubOverview {
    return { sections: SECTIONS, skillsSh: SKILLS_SH }
  }

  static section(id: HubSectionId): HubSection {
    const section = SECTIONS.find(candidate => candidate.id === id)
    if (section === undefined) throw new Error(`Unknown hub section ${id}`)
    return section
  }

  /** Count skills by where they come from; groups without skills are left out. */
  static skillCounts(skills: readonly { readonly source?: string | undefined; readonly provider: string }[]): readonly SkillCount[] {
    const counts = new Map<SkillGroup, number>()
    for (const skill of skills) {
      const group = groupOf(skill.source, skill.provider)
      counts.set(group, (counts.get(group) ?? 0) + 1)
    }
    return GROUP_ORDER.flatMap(group => {
      const count = counts.get(group) ?? 0
      return count === 0 ? [] : [{ group, count }]
    })
  }

  /** The tool result: one line per kind, its trust and its owner, then the skills.sh guidance. */
  static render(overview: HubOverview): string {
    const lines = overview.sections.map(
      section =>
        `${section.label} · ${section.trustLabel} · managed by ${section.manager.label} (${section.manager.owner})${
          section.agentTools.length === 0 ? '' : ` · agent tools: ${section.agentTools.join(', ')}`
        }`,
    )
    return [
      ...lines,
      `skills.sh: ${overview.skillsSh.url} (search on the site; in-app search unavailable). Install command, run by the user only: ${overview.skillsSh.command}`,
    ].join('\n')
  }
}
