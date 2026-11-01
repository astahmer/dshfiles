import { z } from 'zod'
import * as Schema from 'effect/Schema'
import { communicationDeliverySchema, communicationPrioritySchema, legacyCommunicationDeliverySchema } from '../../src/communication/types.ts'

export { z, Schema }
export const fixtures = [
  { name: 'communication-delivery', zod: z.literal('passive'), effect: communicationDeliverySchema, input: 'passive' },
  { name: 'communication-priority', zod: z.enum(['normal', 'urgent']), effect: communicationPrioritySchema, input: 'urgent' },
  {
    name: 'legacy-communication-delivery',
    zod: z.enum(['quiet', 'queue', 'steer']),
    effect: legacyCommunicationDeliverySchema,
    input: 'queue',
  },
]
