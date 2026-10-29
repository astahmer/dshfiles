import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/**
 * Wire contract for the HMR compatibility gate.
 *
 * The Host owns the decision; the Plugins page reads the same shape through the
 * client API and the agent reads it through `hmr_gate_status`, so both see one
 * truth about which rebuilds wait for a Host restart.
 */

const gateReasonSchema = z.literal('host-artifact-changed')

const deferredPackageSchema = z.object({
  id: z.string().min(1).max(256),
  reason: gateReasonSchema,
})

const hmrGateStatusSchema = z.object({
  deferred: z.array(deferredPackageSchema).max(64),
  watched: z.number().int().min(0).max(4096),
})

export type DeferredPackage = z.infer<typeof deferredPackageSchema>
export type HmrGateStatus = z.infer<typeof hmrGateStatusSchema>

/** Model-facing text for the agent tool: names the packages a restart would apply. */
const compactStatus = (status: HmrGateStatus): string =>
  status.deferred.length === 0
    ? 'No plugin client rebuild is waiting for a Host restart.'
    : `Waiting for a Host restart: ${status.deferred.map(entry => entry.id).join(', ')}.`

export const hmrGateApi = defineApi({
  id: 'hmr-gate',
  version: 1,
  methods: {
    status: method({
      input: z.object({}),
      output: hmrGateStatusSchema,
      description: 'Plugin client rebuilds held back because their Host half changed and the running Host has not loaded it. Read-only.',
      tool: { name: 'hmr_gate_status', readOnly: true, render: compactStatus },
    }),
  },
})
