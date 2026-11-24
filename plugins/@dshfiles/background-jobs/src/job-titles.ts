import { decodeJson } from '@dshfiles/dshx/json'
import { Schema } from 'effect'

/**
 * The description a tool call gave the job it started ("Build"). The native job registry keeps only the shell command,
 * so the transcript's tool card, which sees the call, records the title here and the job strip above the composer
 * reads it. Client memory only: a job whose call never rendered falls back to its command.
 */
const titles = new Map<string, string>()
const listeners = new Set<() => void>()
/** The one argument of a bash or pwsh call the strip reads. */
const callArgsSchema = Schema.Struct({ description: Schema.String })

export class JobTitles {
  /** The `description` of a bash or pwsh call, from its raw arguments. */
  static readonly descriptionOf = (argsRaw: string | undefined): string | undefined => {
    if (argsRaw === undefined) return undefined
    try {
      const description = decodeJson(callArgsSchema, argsRaw).description.trim()
      return description === '' ? undefined : description
    } catch {
      return undefined
    }
  }

  static readonly remember = (jobId: string, title: string): void => {
    if (titles.get(jobId) === title) return
    titles.set(jobId, title)
    for (const listener of listeners) listener()
  }

  static readonly titleOf = (jobId: string): string | undefined => titles.get(jobId)

  static readonly subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}
