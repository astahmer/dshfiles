import { Effect, Schema } from 'effect'

export class AgentTelemetryPricingError extends Schema.TaggedError<AgentTelemetryPricingError>()('AgentTelemetryPricingError', {
  message: Schema.String,
  operation: Schema.Literal('catalog'),
}) {}

export const reloadAgentTelemetryPricing = Effect.fn('agent telemetry pricing reload')(({ load }: { readonly load: () => Promise<void> }) =>
  Effect.tryPromise({
    try: load,
    catch: () => new AgentTelemetryPricingError({ message: 'Pricing catalog reload failed.', operation: 'catalog' }),
  }),
)
