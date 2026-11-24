import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'
import { ProjectTone } from './project-tone.js'

const projectNameEntry = Schema.object({
  project: Schema.string().description('Absolute project folder.'),
  name: Schema.string().default('').description('Chip label; empty keeps the folder name.'),
})

const projectColorEntry = Schema.object({
  project: Schema.string().description('Absolute project folder.'),
  tone: Schema.natural()
    .max(ProjectTone.count - 1)
    .default(0)
    .description('Palette index, used when no custom colour is set.'),
  color: Schema.string().default('').description('Custom #rrggbb colour; empty uses the palette index.'),
})

export const workspaceFolderPickerSettings = defineSettings({
  namespace: 'dshfiles-workspace-folder-picker',
  schema: Schema.object({
    projectNames: Schema.array(projectNameEntry)
      .default([])
      .description('Display name per project, for tab chips and labels. A project without an entry shows its folder name.'),
    projectColors: Schema.array(projectColorEntry)
      .default([])
      .description('Colour per project, chosen when the folder is imported; a project without an entry keeps the automatic colour of its folder name.'),
    projectParent: Schema.string()
      .default('')
      .description('Folder the Create project dialog starts in. Empty starts in your home folder; the dialog can remember the last one for you.'),
  }),
  applies: 'live',
})
