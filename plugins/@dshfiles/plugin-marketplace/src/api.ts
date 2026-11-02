import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

const marketplaceLocaleSchema = Schema.Literals(['en', 'zh'])
const marketplaceBadgeSchema = Schema.Literals(['official', 'community'])
const marketplaceCompatibilitySchema = Schema.Literals(['compatible', 'incompatible', 'unknown'])
const marketplaceSortSchema = Schema.Literals(['latest', 'stars'])

const absoluteUrl = Schema.makeFilter((value: string) => (URL.canParse(value) ? undefined : 'Expected an absolute URL.'))

const marketplaceCategorySchema = Schema.Struct({
  slug: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
})

const marketplaceCardSchema = Schema.Struct({
  slug: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
  packageName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
  description: Schema.String.check(Schema.isMaxLength(600)),
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  compatibilityRange: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
  compatibility: marketplaceCompatibilitySchema,
  category: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  badge: marketplaceBadgeSchema,
  glyph: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  iconUrl: Schema.NullOr(Schema.String.check(absoluteUrl)),
  author: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  avatarUrl: Schema.NullOr(Schema.String.check(absoluteUrl)),
  stars: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  updated: Schema.NullOr(Schema.String.check(Schema.isMaxLength(40))),
  installed: Schema.Boolean,
})

const marketplaceListInputSchema = Schema.Struct({
  locale: marketplaceLocaleSchema,
  category: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
  cursor: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000))),
  query: Schema.optionalKey(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  sort: Schema.optionalKey(marketplaceSortSchema),
})

const marketplaceListOutputSchema = Schema.Struct({
  categories: Schema.Array(marketplaceCategorySchema).check(Schema.isMaxLength(100)),
  items: Schema.Array(marketplaceCardSchema).check(Schema.isMaxLength(24)),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
  total: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})

const installFailureCodeSchema = Schema.Literals([
  'busy',
  'catalog-unavailable',
  'target-unavailable',
  'profile-unavailable',
  'compatibility-unknown',
  'incompatible',
  'install-failed',
  'activation-missing',
  'cancelled',
  'timeout',
])

const installSuccessSchema = Schema.Struct({
  status: Schema.Literals(['installed', 'already-installed']),
  packageName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  restartRequired: Schema.Literal(true),
})

const installFailureSchema = Schema.Struct({
  status: Schema.Literal('failed'),
  code: installFailureCodeSchema,
  retryable: Schema.Boolean,
})

const marketplaceInstallOutputSchema = Schema.Union([installSuccessSchema, installFailureSchema])

export type MarketplaceLocale = typeof marketplaceLocaleSchema.Type
export type MarketplaceBadge = typeof marketplaceBadgeSchema.Type
export type MarketplaceSort = typeof marketplaceSortSchema.Type
export type MarketplaceCategory = typeof marketplaceCategorySchema.Type
export type MarketplaceCard = typeof marketplaceCardSchema.Type
export type MarketplaceListInput = typeof marketplaceListInputSchema.Type
export type MarketplaceListOutput = typeof marketplaceListOutputSchema.Type
export type MarketplaceInstallOutput = typeof marketplaceInstallOutputSchema.Type
export type InstallFailureCode = typeof installFailureCodeSchema.Type

export const pluginMarketplaceApi = defineApi({
  id: 'plugin-marketplace',
  version: 1,
  methods: {
    list: method({
      input: marketplaceListInputSchema,
      output: marketplaceListOutputSchema,
    }),
    install: method({
      input: Schema.Struct({
        slug: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), Schema.isMaxLength(160)),
      }),
      output: marketplaceInstallOutputSchema,
    }),
  },
})
