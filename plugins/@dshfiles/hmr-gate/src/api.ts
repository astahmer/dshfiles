import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

/**
 * Wire contract for the HMR compatibility gate.
 *
 * The Host owns the decision; the Plugins page reads the same shape through the
 * client API and the agent reads it through `hmr_gate_status`, so both see one
 * truth about which rebuilds wait for a Host restart.
 */

const gateReasonSchema = Schema.Literal('host-artifact-changed')

const deferredPackageSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  reason: gateReasonSchema,
})

const hmrGateStatusSchema = Schema.Struct({
  deferred: Schema.Array(deferredPackageSchema).check(Schema.isMaxLength(64)),
  watched: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(4096)),
})

export type DeferredPackage = typeof deferredPackageSchema.Type
export type HmrGateStatus = typeof hmrGateStatusSchema.Type

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
      input: Schema.Struct({}),
      output: hmrGateStatusSchema,
      description: 'Plugin client rebuilds held back because their Host half changed and the running Host has not loaded it. Read-only.',
      tool: { name: 'hmr_gate_status', readOnly: true, render: compactStatus },
    }),
  },
})
