import type { CommandItem } from '@dshfiles/dshx/client'
import type { CommandClaim, InputTriggerSource } from './client/index.js'

const run = async (command: CommandItem): Promise<void> => {
  if (command.enabled === false) throw new Error(`/${command.slash ?? command.id} is unavailable right now.`)
  await command.run()
}

/**
 * The composer's `/` entries for dshx `Command`s that name a `slash`: picking one runs it and clears its token, and
 * sending a line that is exactly the entry runs it as a command claim.
 */
export class CommandSlashSource {
  static create = (commands: readonly CommandItem[]): InputTriggerSource => {
    const bySlash = new Map(commands.flatMap(command => (command.slash === undefined || command.slash === '' ? [] : [[command.slash, command] as const])))
    const claimFor = (command: CommandItem, slash: string): CommandClaim => ({
      name: slash,
      token: `/${slash} `,
      submit: async () => {
        try {
          await run(command)
          return { kind: 'success' }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    })
    return {
      trigger: '/',
      name: 'dshx-commands',
      showGroupTitle: false,
      async candidates(_session, request) {
        if (request.position !== 'leading') return []
        const query = request.query.toLowerCase()
        return [...bySlash]
          .filter(([slash, command]) => command.enabled !== false && slash.toLowerCase().startsWith(query))
          .map(([slash, command]) => ({ name: slash, label: command.title, ...(command.description !== undefined && { description: command.description }) }))
      },
      onPick: pick => {
        const command = bySlash.get(pick.candidate.name)
        if (command === undefined) return undefined
        void run(command).catch((error: unknown) => console.error(`input-trigger: /${pick.candidate.name} failed`, error))
        return { text: '' }
      },
      async matchEnter(_session, line) {
        const command = bySlash.get(line.slice(1))
        return line.startsWith('/') && command !== undefined ? { claim: claimFor(command, line.slice(1)) } : undefined
      },
    }
  }
}
