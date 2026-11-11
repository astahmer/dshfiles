import { defineApi, method } from '@dshfiles/dshx/api'
import { OnboardingOverview, overviewInputSchema, overviewSchema } from './overview-model.js'

export const onboardingApi = defineApi({
  id: 'onboarding',
  version: 1,
  owner: '@dshfiles/onboarding',
  methods: {
    overview: method({
      input: overviewInputSchema,
      output: overviewSchema,
      description:
        'What this DSH setup can do and what is still missing: the setup checklist (model provider registered, project added, project is a jj or git repository, GitHub CLI signed in) read live from the Host, each plugin pack with every plugin enabled, disabled or not installed, and the catalogued features grouped by destination with where each lives and how to open it. Search with `query` (every word must match), narrow with `destination`; curated features only until a query is given unless `curatedOnly` says otherwise. Changes nothing. Read-only.',
      tool: { name: 'onboarding_overview', readOnly: true, render: OnboardingOverview.render },
    }),
  },
})
