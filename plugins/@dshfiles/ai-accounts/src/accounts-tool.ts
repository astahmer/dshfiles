import { HostContext, Tool } from '@dshfiles/dshx/effect'
import { Effect, Schema } from 'effect'
import { accountRuntime } from './account-runtime.js'
import { AccountsHostApiModel } from './accounts-host-api.js'

const accountReport = Schema.Struct({
  route: Schema.String,
  kind: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  signedIn: Schema.Boolean,
  identity: Schema.NullOr(Schema.String),
  plan: Schema.NullOr(Schema.String),
  state: Schema.String,
  home: Schema.String,
  mode: Schema.String,
})

const accountsReport = Schema.Struct({
  distribution: Schema.String,
  cooldownMs: Schema.Number,
  skipped: Schema.Array(Schema.String),
  accounts: Schema.Array(accountReport),
})

const renderReport = (value: typeof accountsReport.Type): string =>
  [
    `Distribution: ${value.distribution} (cooldown ${Math.round(value.cooldownMs / 1000)}s)`,
    '',
    ...value.accounts.map(account =>
      [
        `${account.name} — route \`${account.route}\``,
        `  kind: ${account.kind}`,
        `  signed in: ${account.signedIn ? (account.identity ?? 'yes') : 'no'}${account.plan === null ? '' : ` (${account.plan})`}`,
        `  home: ${account.home === '' ? '—' : account.home} [${account.mode}]`,
        `  pool: ${account.state}`,
      ].join('\n'),
    ),
    ...(value.skipped.length === 0 ? [] : ['', 'Skipped (no route registered):', ...value.skipped.map(reason => `  ${reason}`)]),
  ].join('\n')

/**
 * Read-only account report.
 *
 * The tool and the settings page call the same `AccountsHostApiModel.accountsFile`, so an agent
 * and a human never disagree about which account serves what. It reads only:
 * there is no operation here that could sign in, rotate, or reconfigure an
 * account, and none should be added without the same thought applied to the
 * page.
 */
export const aiAccountsTool = Tool.make({
  name: 'ai_accounts',
  description:
    'List the configured Codex and OpenCode Go accounts: their model routes, whether each holds a login, and how the pool currently spreads requests.',
  input: Schema.Struct({}),
  output: accountsReport,
  readOnly: true,
  render: renderReport,
  execute: Effect.fn('ai accounts tool report')(function* () {
    const host = yield* HostContext
    const snapshot = yield* Effect.promise(() => AccountsHostApiModel.accountsFile(host.ctx))
    return {
      distribution: snapshot.distribution,
      cooldownMs: snapshot.cooldownMs,
      skipped: [...(accountRuntime(host.ctx)?.rejectedRoutes ?? [])],
      accounts: snapshot.accounts.map(account => ({
        route: account.instanceId,
        kind: account.kind,
        name: account.displayName,
        enabled: account.enabled,
        signedIn: account.signedIn,
        identity: account.identity,
        plan: account.plan,
        state: account.state,
        home:
          account.kind === 'codex'
            ? account.shadowHomePath === ''
              ? account.homePath
              : account.shadowHomePath
            : account.kind === 'claude'
              ? account.homePath
              : account.apiBaseUrl,
        mode: account.mode,
      })),
    }
  }),
})
