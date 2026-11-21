import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'
import { PROJECT_TONE_COUNT } from './project-tone.js'

const projectToneEntry = Schema.object({
  project: Schema.string().description('Absolute project folder.'),
  tone: Schema.natural()
    .max(PROJECT_TONE_COUNT - 1)
    .description('Colour index of the project chip.'),
})

export const workspaceFolderPickerSettings = defineSettings({
  namespace: 'dshfiles-workspace-folder-picker',
  schema: Schema.object({
    projectTones: Schema.array(projectToneEntry)
      .default([])
      .description('Colour per project, chosen when the folder is imported; a project without an entry keeps the automatic colour of its folder name.'),
  }),
  applies: 'live',
})
