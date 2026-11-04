import type { ConnectionTestStep } from '../api.js'

type ConnectionTestOutcome =
  | { readonly kind: 'passed'; readonly steps: readonly ConnectionTestStep[]; readonly dshVersion: string; readonly profile: string }
  | { readonly kind: 'failed'; readonly message: string }

/** Plain-text report of one connection test, for pasting into an issue or a chat with the agent. */
export const connectionDiagnostics = (input: {
  readonly sshTarget: string
  readonly remoteHome: string
  readonly localVersion: string | undefined
  readonly outcome: ConnectionTestOutcome
}): string => {
  const lines = [
    `Host: ${input.sshTarget}`,
    `Remote DSH home: ${input.remoteHome}`,
    `This machine: DSH ${input.localVersion ?? 'unknown'}`,
    `Tested: ${new Date().toISOString()}`,
  ]
  if (input.outcome.kind === 'failed') return [...lines, `Result: failed — ${input.outcome.message}`].join('\n')
  return [
    ...lines,
    `Result: passed · DSH ${input.outcome.dshVersion} · profile ${input.outcome.profile}`,
    ...input.outcome.steps.map(
      step =>
        `- ${step.step}: ${step.ok ? 'ok' : 'failed'} in ${step.ms} ms${step.message === undefined ? '' : ` — ${step.message}`}${step.code === undefined ? '' : ` (${step.code})`}`,
    ),
  ].join('\n')
}

/** The remote DSH version when it differs from this machine's; undefined while either is unknown. */
export const versionMismatch = (input: { readonly localVersion: string | undefined; readonly remoteVersion: string | undefined }): string | undefined => {
  if (input.localVersion === undefined || input.remoteVersion === undefined) return undefined
  return input.localVersion === input.remoteVersion ? undefined : input.remoteVersion
}
