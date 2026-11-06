import type { ScratchHosts } from './types.js'

/** The status strip warns only while orphaned scratch Hosts use at least the configured CPU or memory. */
export const orphanAlertVisible = (summary: ScratchHosts | undefined): boolean =>
  summary !== undefined && summary.orphanCount > 0 && (summary.orphanCpuPercent >= summary.alert.cpuPercent || summary.orphanBytes >= summary.alert.memoryBytes)
