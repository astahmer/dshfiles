import { Effect, type Context } from 'effect'
import type { PricingCatalog } from './pricing-catalog.js'
import type { PricingCatalog as PricingCatalogService } from './pricing-catalog-service.js'

/** The Promise view of the pricing service the unported Host code still holds. */
export type PricingCatalogPromise = PricingCatalog

/**
 * The pricing catalog for the two Promise callers left: the settings page asks for its status synchronously, and model
 * chunk pricing cannot suspend. Everything else yields the service.
 */
export class PricingCatalogPromiseModel {
  static readonly facade = (catalog: PricingCatalogService['Service'], services: Context.Context<never>): PricingCatalogPromise => {
    const run = Effect.runPromiseWith(services)
    return {
      load: () => run(catalog.load),
      refresh: () => run(catalog.refresh),
      ensureFresh: maxAgeMs => run(catalog.ensureFresh(maxAgeMs)),
      status: catalog.snapshotStatus,
      current: catalog.snapshot,
    }
  }
}
