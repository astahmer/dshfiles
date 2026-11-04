import { Effect, Option, Schema } from 'effect'
import type { RemoteFacts } from './remote-doctor.js'
import { RemoteExec } from './remote-exec.js'
import { shellQuote } from './ssh.js'

const dshxCli = 'tooling/dshx/packages/dshx/dist/cli/bin.js'

/** What `dshx checkout sync --json` reports, read once at the remote boundary. */
const syncEnvelopeSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    data: Schema.Struct({
      to: Schema.NullOr(Schema.String),
      unlanded: Schema.Array(Schema.Unknown),
      conflicts: Schema.Array(Schema.Unknown),
      rebuilt: Schema.Struct({ plugins: Schema.Array(Schema.String) }),
      restart: Schema.Struct({ needed: Schema.Boolean }),
    }),
  }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ message: Schema.String, hint: Schema.optional(Schema.String) }) }),
])

export interface HostUpdateResult {
  readonly ok: boolean
  readonly applied: boolean
  readonly checkoutPath: string
  readonly revision: string | undefined
  readonly rebuilt: readonly string[]
  readonly restartNeeded: boolean
  readonly detail: string
}

/** Why a machine cannot run the update; undefined when it can. */
const blockedReason = (input: { readonly facts: RemoteFacts; readonly nodePath: string | undefined }): string | undefined => {
  if (!input.facts.checkout.exists) return `no dshfiles checkout at ${input.facts.checkout.path}; provision the host first`
  if (input.facts.jj.path === undefined) return 'jj is not installed on the host'
  if (input.nodePath === undefined) return 'no official Node build on the host; provision its node step first'
  if (!input.facts.checkout.built) return 'the host checkout is not built yet; provision its build step first'
  return undefined
}

/** Fetch the host's repository, then let its own `dshx checkout sync` rebase, install and rebuild what changed. */
const commandsOf = (input: { readonly facts: RemoteFacts; readonly nodePath: string; readonly bookmark: string; readonly apply: boolean }) => {
  const path = shellQuote(input.facts.checkout.path)
  const jj = shellQuote(input.facts.jj.path ?? 'jj')
  const directories = [input.nodePath, input.facts.pnpm.path].flatMap(file => (file === undefined ? [] : [file.slice(0, file.lastIndexOf('/'))]))
  const environment = `env PATH=${[...directories.map(shellQuote), '"$PATH"'].join(':')}`
  const sync = `cd ${path} && ${environment} ${shellQuote(input.nodePath)} ${dshxCli} checkout sync --bookmark ${shellQuote(input.bookmark)} --json${input.apply ? '' : ' --dry-run'}`
  return { fetch: `${jj} -R ${path} git fetch`, sync }
}

/** Turn the sync envelope into the update result; output that is not the envelope is reported, never guessed. */
const readSyncOutput = (input: { readonly stdout: string; readonly apply: boolean; readonly checkoutPath: string }): HostUpdateResult => {
  const base = { applied: input.apply, checkoutPath: input.checkoutPath, revision: undefined, rebuilt: [], restartNeeded: false }
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(syncEnvelopeSchema))(input.stdout.trim())
  if (Option.isNone(decoded)) return { ...base, ok: false, detail: 'the host checkout sync printed no result; update dshx on the host and retry' }
  const envelope = decoded.value
  if (!envelope.ok) return { ...base, ok: false, detail: `${envelope.error.message}${envelope.error.hint === undefined ? '' : ` ${envelope.error.hint}`}` }
  const { data } = envelope
  const rebuilt = data.rebuilt.plugins
  const revision = data.to ?? undefined
  if (data.conflicts.length > 0) return { ...base, ok: false, revision, detail: 'the host checkout conflicts with main; resolve it on the host' }
  if (data.unlanded.length > 0)
    return { ...base, ok: false, revision, detail: 'the host checkout holds described work main lacks; land or abandon it on the host' }
  const detail =
    rebuilt.length === 0
      ? input.apply
        ? 'up to date'
        : 'already up to date'
      : `${input.apply ? 'rebuilt' : 'would rebuild'} ${rebuilt.length} plugin${rebuilt.length === 1 ? '' : 's'}`
  return { ...base, ok: true, revision, rebuilt, restartNeeded: data.restart.needed, detail }
}

const runHostUpdate = Effect.fn('remote host update')(function* (input: {
  readonly sshTarget: string
  readonly facts: RemoteFacts
  readonly nodePath: string | undefined
  readonly bookmark: string
  readonly apply: boolean
}) {
  const checkoutPath = input.facts.checkout.path
  const blocked = blockedReason({ facts: input.facts, nodePath: input.nodePath })
  if (blocked !== undefined || input.nodePath === undefined) {
    return {
      ok: false,
      applied: false,
      checkoutPath,
      revision: undefined,
      rebuilt: [],
      restartNeeded: false,
      detail: blocked ?? 'no Node',
    } satisfies HostUpdateResult
  }
  const commands = commandsOf({ facts: input.facts, nodePath: input.nodePath, bookmark: input.bookmark, apply: input.apply })
  const fetched = yield* RemoteExec.run({ sshTarget: input.sshTarget, command: commands.fetch, timeoutMs: 180_000 })
  if (!fetched.ok) {
    const reason = fetched.stderr.trim().split('\n').at(-1) ?? ''
    return {
      ok: false,
      applied: false,
      checkoutPath,
      revision: undefined,
      rebuilt: [],
      restartNeeded: false,
      detail: `jj git fetch failed on the host: ${reason}`,
    } satisfies HostUpdateResult
  }
  const synced = yield* RemoteExec.run({ sshTarget: input.sshTarget, command: commands.sync, timeoutMs: 1_200_000 })
  if (synced.timedOut) {
    return {
      ok: false,
      applied: input.apply,
      checkoutPath,
      revision: undefined,
      rebuilt: [],
      restartNeeded: false,
      detail: 'the host checkout sync timed out after 20 min; retry or read its output on the host',
    } satisfies HostUpdateResult
  }
  return readSyncOutput({ stdout: synced.stdout, apply: input.apply, checkoutPath })
})

export class RemoteUpdate {
  static readonly blockedReason = blockedReason
  static readonly commands = commandsOf
  static readonly readSyncOutput = readSyncOutput
  static readonly run = runHostUpdate
}
