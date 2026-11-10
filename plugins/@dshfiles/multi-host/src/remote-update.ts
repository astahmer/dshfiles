import { Effect, Option, Schema } from 'effect'
import type { RemoteFacts } from './remote-doctor.js'
import { RemoteCheckout, type CheckoutRecovery } from './remote-checkout.js'
import { RemoteExec } from './remote-exec.js'
import { shellQuote } from './ssh.js'

const dshxCli = 'tooling/dshx/packages/dshx/dist/cli/bin.js'

/** What `dshx checkout sync --json` reports, read once at the remote boundary. */
const syncEnvelopeSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    data: Schema.Struct({
      status: Schema.optional(Schema.String),
      to: Schema.NullOr(Schema.String),
      unlanded: Schema.Array(Schema.Unknown),
      conflicts: Schema.Array(Schema.Unknown),
      rebuilt: Schema.Struct({ plugins: Schema.Array(Schema.String) }),
      restart: Schema.Struct({ needed: Schema.Boolean }),
    }),
  }),
  // A refused, conflicted or failed build run reports its result, not an error.
  Schema.Struct({
    ok: Schema.Literal(false),
    data: Schema.Struct({ status: Schema.String, to: Schema.NullOr(Schema.String), hint: Schema.NullOr(Schema.String) }),
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
  /** Revisions origin has that this checkout lacks, and revisions here origin lacks. */
  readonly incoming: number
  readonly outgoing: number
  readonly recovery: readonly CheckoutRecovery[]
}

/** Why a machine cannot run the update; undefined when it can. */
const blockedReason = (input: { readonly facts: RemoteFacts; readonly nodePath: string | undefined }): string | undefined => {
  if (!input.facts.checkout.exists) return `no dshfiles checkout at ${input.facts.checkout.path}; provision the host first`
  if (input.facts.jj.path === undefined) return 'jj is not installed on the host'
  if (input.nodePath === undefined) return 'no official Node build on the host; provision its node step first'
  if (!input.facts.checkout.built) return 'the host checkout is not built yet; provision its build step first'
  return undefined
}

/** The host's own `dshx checkout sync`, which rebases, installs and rebuilds what changed; the fetch comes first. */
const commandsOf = (input: { readonly facts: RemoteFacts; readonly nodePath: string; readonly bookmark: string; readonly apply: boolean }) => {
  const path = shellQuote(input.facts.checkout.path)
  const directories = [input.nodePath, input.facts.pnpm.path].flatMap(file => (file === undefined ? [] : [file.slice(0, file.lastIndexOf('/'))]))
  const environment = `env PATH=${[...directories.map(shellQuote), '"$PATH"'].join(':')}`
  const sync = `cd ${path} && ${environment} ${shellQuote(input.nodePath)} ${dshxCli} checkout sync --bookmark ${shellQuote(input.bookmark)} --json${input.apply ? '' : ' --dry-run'}`
  return { sync }
}

/** Turn the sync envelope into the update result; output that is not the envelope is reported, never guessed. */
const readSyncOutput = (input: { readonly stdout: string; readonly apply: boolean; readonly checkoutPath: string }): HostUpdateResult => {
  const base = {
    applied: input.apply,
    checkoutPath: input.checkoutPath,
    revision: undefined,
    rebuilt: [],
    restartNeeded: false,
    incoming: 0,
    outgoing: 0,
    recovery: [],
  }
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(syncEnvelopeSchema))(input.stdout.trim())
  if (Option.isNone(decoded)) return { ...base, ok: false, detail: 'the host checkout sync printed no result; update dshx on the host and retry' }
  const envelope = decoded.value
  if (!envelope.ok && 'data' in envelope) {
    return {
      ...base,
      ok: false,
      applied: false,
      revision: envelope.data.to ?? undefined,
      detail: envelope.data.hint ?? `the host checkout sync ended ${envelope.data.status}; run it on the host to see why`,
    }
  }
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
        : data.status === 'would-sync'
          ? 'would rebase; nothing to rebuild'
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
  const failure = {
    ok: false,
    applied: false,
    checkoutPath,
    revision: undefined,
    rebuilt: [],
    restartNeeded: false,
    incoming: 0,
    outgoing: 0,
    recovery: [],
  } satisfies Omit<HostUpdateResult, 'detail'>
  const blocked = blockedReason({ facts: input.facts, nodePath: input.nodePath })
  if (blocked !== undefined || input.nodePath === undefined) {
    return { ...failure, detail: blocked ?? 'no Node' } satisfies HostUpdateResult
  }
  const commands = commandsOf({ facts: input.facts, nodePath: input.nodePath, bookmark: input.bookmark, apply: input.apply })
  const { exec, inspection } = yield* RemoteCheckout.fetchAndInspect({ sshTarget: input.sshTarget, path: checkoutPath, bookmark: input.bookmark })
  if (!exec.ok) return { ...failure, detail: `the host could not be read: ${exec.stderr.trim().split('\n').at(-1) ?? ''}` } satisfies HostUpdateResult
  // dshx refuses unlanded work and undoes conflicts itself; what it cannot read past is a bookmark with two targets.
  const standing = RemoteCheckout.standingStatus(inspection)
  if (inspection.stop !== undefined || standing === 'bookmark-conflict') {
    const report = RemoteCheckout.report({
      path: checkoutPath,
      bookmark: input.bookmark,
      status: standing ?? 'failed',
      inspection,
      reason: inspection.stop?.detail ?? '',
    })
    return { ...failure, detail: report.detail, recovery: report.recovery } satisfies HostUpdateResult
  }
  const counts = { incoming: inspection.incoming.total, outgoing: inspection.outgoing.total + inspection.unpushedBookmark.total }
  const synced = yield* RemoteExec.run({ sshTarget: input.sshTarget, command: commands.sync, timeoutMs: 1_200_000 })
  if (synced.timedOut) {
    return {
      ...failure,
      ...counts,
      applied: input.apply,
      detail: 'the host checkout sync timed out after 20 min; retry or read its output on the host',
    } satisfies HostUpdateResult
  }
  const result = readSyncOutput({ stdout: synced.stdout, apply: input.apply, checkoutPath })
  const recovery = result.ok || result.detail.length === 0 ? result.recovery : [{ label: result.detail }]
  return { ...result, ...counts, recovery } satisfies HostUpdateResult
})

export class RemoteUpdate {
  static readonly blockedReason = blockedReason
  static readonly commands = commandsOf
  static readonly readSyncOutput = readSyncOutput
  static readonly run = runHostUpdate
}
