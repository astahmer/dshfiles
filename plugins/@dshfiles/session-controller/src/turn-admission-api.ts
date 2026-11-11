import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { turnAdmissionPolicySchema, turnAdmissionSnapshotSchema } from './turn-admission.ts'

export { turnAdmissionPolicySchema, turnAdmissionSnapshotSchema } from './turn-admission.ts'
export type { TurnAdmissionPolicy, TurnAdmissionSnapshot } from './turn-admission.ts'

const describeSnapshot = (snapshot: typeof turnAdmissionSnapshotSchema.Type): string => {
  const cap = snapshot.policy.maxRunningThreads === 0 ? 'no limit' : `limit ${String(snapshot.policy.maxRunningThreads)}`
  return `${String(snapshot.running)} running (${cap}), ${String(snapshot.waiting.length)} waiting: ${JSON.stringify(snapshot)}`
}

/** Cap on how many threads run a turn at once, with the FIFO queue of turns waiting for a free slot. */
export const turnAdmissionApi = defineApi({
  id: 'session-turn-admission',
  owner: '@dshfiles/session-controller',
  version: 1,
  methods: {
    snapshot: method({
      description:
        'Read the running-thread limit (maxRunningThreads, 0 = unlimited; countSubagents), how many threads run now, and the threads whose new turn waits for a free slot, oldest first with how many are ahead. Read-only.',
      input: Schema.Struct({}),
      output: turnAdmissionSnapshotSchema,
      tool: { name: 'thread_admission_status', readOnly: true, render: describeSnapshot },
    }),
    configure: method({
      description:
        'Set how many threads may run a turn at once (0 = unlimited) and whether running subagents take a slot. Lowering it never stops running turns; raising it or setting 0 starts waiting turns. Run only when the user asked.',
      input: turnAdmissionPolicySchema,
      output: turnAdmissionSnapshotSchema,
      tool: { name: 'thread_admission_configure', render: describeSnapshot },
    }),
    forceStart: method({
      description: "Start a thread's waiting turn now, past the running-thread limit. Run only when the user asked.",
      input: Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)) }),
      output: Schema.Struct({ started: Schema.Number }),
      tool: {
        name: 'thread_admission_force_start',
        render: output => (output.started === 0 ? 'That thread has no waiting turn.' : 'Started.'),
      },
    }),
  },
})
