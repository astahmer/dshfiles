/**
 * Loader row entry for the owned storage-domain fork: the upstream plugin
 * module exports `apply`/`name`/`inject`/`Config`, plus the spec vocabulary the
 * owning packages import. The fork only adds a lazy-hydration seeding path
 * (and the optional `hydration` spec field that opts a domain into it).
 * @module @dshfiles/storage-domain
 */

export { apply, Config, inject, name } from './native/index.ts'
export { DomainError, DomainFacility, defineDomain, descriptorOf, domainTable } from './native/index.ts'
export type {
  DomainChanged,
  DomainGlobalSpec,
  DomainSpec,
  DomainTableSpec,
  GlobalValueOf,
  TableKeyOf,
  TableValueOf,
} from './native/index.ts'
