import { defineHost } from '@dshfiles/dshx/host'
import { agentPlanSettings } from './settings.js'

export default defineHost({ name: '@dshfiles/agent-plan', settings: [agentPlanSettings] })
