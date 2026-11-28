import { Context, Effect, Layer, Option } from 'effect'
import { BrowseCli, type BrowseCommandFailed, type BrowseNotInstalled } from './browse-cli.js'
import { BROWSE_INSTALL_HELP, BrowseOutput, type BrowseStatus, type Pairings } from './model.js'
import { BrowsePairing } from './pairing.js'

const STATUS_RECOVERY = 'Run `browse status` in a terminal to see the error; `browse update` installs the latest version.'

/** Reads and pairing-list verbs over the browse CLI; `status` never starts the relay. */
export class Browse extends Context.Service<
  Browse,
  {
    readonly status: Effect.Effect<BrowseStatus>
    readonly pairings: Effect.Effect<Pairings, BrowseNotInstalled | BrowseCommandFailed>
    readonly revoke: (target: string) => Effect.Effect<{ readonly revoked: boolean; readonly message: string }, BrowseNotInstalled | BrowseCommandFailed>
  }
>()('@dshfiles/browse/Browse') {
  static readonly layer = Layer.effect(
    Browse,
    Effect.gen(function* () {
      const cli = yield* BrowseCli
      const pairing = yield* BrowsePairing

      const status = Effect.gen(function* () {
        const current = yield* pairing.current
        const command = yield* cli.command
        return yield* cli.run({ verb: 'status', args: ['status', '--json'] }).pipe(
          Effect.map((output): BrowseStatus => {
            const parsed = output.exitCode === 0 ? BrowseOutput.parseStatus({ stdout: output.stdout, command, pairing: current }) : Option.none()
            if (Option.isSome(parsed)) return parsed.value
            return {
              kind: 'failed',
              command,
              message:
                output.exitCode === 0 ? 'browse status answered something this plugin cannot read.' : `browse status exited with code ${output.exitCode}.`,
              recovery: STATUS_RECOVERY,
              pairing: current,
            }
          }),
          Effect.catchTags({
            BrowseNotInstalled: error =>
              Effect.succeed<BrowseStatus>({ kind: 'not-installed', command: error.command, recovery: BROWSE_INSTALL_HELP, pairing: current }),
            BrowseCommandFailed: error =>
              Effect.succeed<BrowseStatus>({ kind: 'failed', command, message: error.message, recovery: STATUS_RECOVERY, pairing: current }),
          }),
        )
      })

      const pairings = Effect.map(cli.run({ verb: 'pair list', args: ['pair', '--list'] }), output => BrowseOutput.parsePairList(output.stdout))

      const revoke = (target: string) =>
        Effect.map(cli.run({ verb: 'pair revoke', args: ['pair', '--revoke', target] }), output =>
          output.exitCode === 0
            ? { revoked: true, message: `Unpaired ${BrowseOutput.clamp(target, 200)}. Pair it again with a new code when you need it.` }
            : {
                revoked: false,
                message: `No paired browser matches ${BrowseOutput.clamp(target, 200)}. List them again; it may already be unpaired.`,
              },
        )

      return Browse.of({ status, pairings, revoke })
    }),
  )
}
