import * as Schema from 'effect/Schema'
import { communicationDeliverySchema, communicationPrioritySchema, legacyCommunicationDeliverySchema } from '../../src/communication/types.ts'

export { Schema }
export const fixtures = [
  {
    name: 'communication-delivery',
    expectedSchema: { type: 'string', enum: ['passive'] },
    effect: communicationDeliverySchema,
    input: 'passive',
    expectedOutput: 'passive',
  },
  {
    name: 'communication-priority',
    expectedSchema: { type: 'string', enum: ['normal', 'urgent'] },
    effect: communicationPrioritySchema,
    input: 'urgent',
    expectedOutput: 'urgent',
  },
  {
    name: 'legacy-communication-delivery',
    expectedSchema: { type: 'string', enum: ['quiet', 'queue', 'steer'] },
    effect: legacyCommunicationDeliverySchema,
    input: 'queue',
    expectedOutput: 'queue',
  },
]
