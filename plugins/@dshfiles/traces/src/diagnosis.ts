import type { DiagnosisCode, Exporters, ReceiverState, ViewerMode } from './types.js'

const RESTART_HINT =
  'A restart from the DSH UI respawns the Host with the environment of the process that supervises it, so after changing the launcher environment (nixapply, ~/.local/bin/dsh-web) restart `dsh-web` itself from a terminal.'

/** Why telemetry does or does not reach this receiver, in the order a user would check it. */
const diagnose = (input: {
  readonly mode: ViewerMode
  readonly state: ReceiverState
  readonly endpoint: string | null
  readonly configuredPort: number
  readonly receiverMessage: string | null
  readonly lastReceivedAt: number | null
  readonly exporters: Exporters
}): { readonly code: DiagnosisCode; readonly message: string } => {
  if (input.mode === 'external')
    return {
      code: 'external-mode',
      message: 'External mode: the receiver is off and exporters send to the external viewer; this panel only shows what was stored before.',
    }
  if (input.state === 'port-in-use')
    return {
      code: 'port-in-use',
      message: `Port ${String(input.configuredPort)} is held by another process, so nothing reaches this receiver and this Host's exporters have no in-process target. Stop the other process or change the port; the receiver retries every 30 s.`,
    }
  if (input.state === 'failed') return { code: 'failed', message: input.receiverMessage ?? 'The receiver failed to start.' }
  if (input.state !== 'listening' || input.endpoint === null) return { code: 'starting', message: 'The receiver is starting.' }
  const traces = input.exporters.traces
  if (traces.source === 'environment' && input.exporters.environmentPointsHere === false)
    return {
      code: 'exporting-elsewhere',
      message: `This DSH process exports to ${traces.url ?? 'another endpoint'} (OTEL_EXPORTER_OTLP_ENDPOINT), not to this receiver at ${input.endpoint}. Unset the variable, or point it here. ${RESTART_HINT}`,
    }
  if (traces.source === 'off')
    return {
      code: 'no-exporter',
      message: `This DSH process has no OTLP exporter configured (OTEL_SDK_DISABLED, OTEL_TRACES_EXPORTER=none or a non-HTTP OTEL_EXPORTER_OTLP_ENDPOINT turns them off). ${RESTART_HINT}`,
    }
  if (input.lastReceivedAt !== null) return { code: 'receiving', message: 'Telemetry is arriving.' }
  return {
    code: 'waiting',
    message: `Listening on ${input.endpoint}. This Host's plugin spans arrive within 5 s of a plugin call and usage metrics every 60 s, without any environment variable. Other processes need OTEL_EXPORTER_OTLP_ENDPOINT=${input.endpoint}.`,
  }
}

export class ReceiverDiagnosis {
  static readonly diagnose = diagnose
  static readonly restartHint = RESTART_HINT
}
