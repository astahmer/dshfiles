import type { ConnectionTestStep } from '../api.js'

type ConnectionTestOutcome =
  | { readonly kind: 'passed'; readonly steps: readonly ConnectionTestStep[]; readonly dshVersion: string; readonly profile: string }
  | { readonly kind: 'failed'; readonly steps: readonly ConnectionTestStep[]; readonly message: string }

const stepLine = (step: ConnectionTestStep): string =>
  `- ${step.step}: ${step.ok ? 'ok' : 'failed'} in ${step.ms} ms${step.message === undefined ? '' : ` — ${step.message}`}${step.code === undefined ? '' : ` (${step.code})`}`

export class ConnectionDiagnostics {
  static readonly recovery = (step: ConnectionTestStep['step'] | undefined): string => {
    if (step === 'ssh') return 'Verify the SSH target, credentials, and host key, then diagnose again.'
    if (step === 'runtime') return 'Start DSH on the remote home with @dshfiles/multi-host installed, then diagnose again.'
    if (step === 'identity') return 'Check the remote profile and multi-host identity, then diagnose again.'
    return 'Edit the SSH target or remote DSH home, then diagnose again.'
  }

  static readonly createReport = (input: {
    readonly sshTarget: string
    readonly remoteHome: string
    readonly localVersion: string | undefined
    readonly outcome: ConnectionTestOutcome
  }): string => {
    const result =
      input.outcome.kind === 'failed'
        ? `Result: failed — ${input.outcome.message}`
        : `Result: passed · DSH ${input.outcome.dshVersion} · profile ${input.outcome.profile}`
    return [
      `Host: ${input.sshTarget}`,
      `Remote DSH home: ${input.remoteHome}`,
      `This machine: DSH ${input.localVersion ?? 'unknown'}`,
      `Tested: ${new Date().toISOString()}`,
      result,
      ...input.outcome.steps.map(stepLine),
    ].join('\n')
  }

  static readonly versionMismatch = (input: { readonly localVersion: string | undefined; readonly remoteVersion: string | undefined }): string | undefined => {
    if (input.localVersion === undefined || input.remoteVersion === undefined) return undefined
    return input.localVersion === input.remoteVersion ? undefined : input.remoteVersion
  }
}
