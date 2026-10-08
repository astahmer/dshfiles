import { defineTool } from '@dshfiles/dshx/host'

/**
 * Read-only account report.
 *
 * The tool and the settings page call the same `accountsSnapshot`, so an agent
 * and a human never disagree about which account serves what. It reads only:
 * there is no operation here that could sign in, rotate, or reconfigure an
 * account, and none should be added without the same thought applied to the
 * page.
 */
export const aiAccountsTool = defineTool({
  name: 'ai_accounts',
  description:
    'List the configured Codex and OpenCode Go accounts: their model routes, whether each holds a login, and how the pool currently spreads requests.',
  parameters: {},
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        distribution: { type: 'string' },
        cooldownMs: { type: 'number' },
        accounts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              route: { type: 'string' },
              kind: { type: 'string' },
              name: { type: 'string' },
              enabled: { type: 'boolean' },
              signedIn: { type: 'boolean' },
              identity: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              plan: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              state: { type: 'string' },
              home: { type: 'string' },
              mode: { type: 'string' },
            },
          },
        },
      },
    },
    render(_args, value) {
      const lines = [
        `Distribution: ${value.distribution ?? 'sticky'} (cooldown ${Math.round((value.cooldownMs ?? 0) / 1000)}s)`,
        '',
        ...(value.accounts ?? []).map(account =>
          [
            `${account.name} — route \`${account.route}\``,
            `  kind: ${account.kind}`,
            `  signed in: ${account.signedIn ? (account.identity ?? 'yes') : 'no'}${account.plan === null ? '' : ` (${account.plan})`}`,
            `  home: ${account.home === '' ? '—' : account.home} [${account.mode}]`,
            `  pool: ${account.state}`,
          ].join('\n'),
        ),
      ]
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  execute: async (_args, exec) => {
    const ctx = exec.agent?.ctx
    if (ctx === undefined) throw new Error('AI Accounts requires an active agent context.')
    const { accountsSnapshot } = await import('./host.js')
    const snapshot = await accountsSnapshot(ctx)
    return {
      distribution: snapshot.distribution,
      cooldownMs: snapshot.cooldownMs,
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
  },
})
