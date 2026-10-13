import { createLongScenario } from '../long-scenarios.mjs'

export const createScenario = ({ rep = 1, variant = 'long' } = {}) => createLongScenario({ name: 'infra-rollout', rep, variant })
