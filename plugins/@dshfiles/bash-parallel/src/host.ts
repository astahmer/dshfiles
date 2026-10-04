import { defineHost } from '@dshfiles/dshx/host'
import { readOnlyBashTool } from './tool.js'

export default defineHost({
  name: '@dshfiles/bash-parallel',
  inject: ['subprocess'],
  tools: [readOnlyBashTool],
})
