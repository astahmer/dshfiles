/**
 * Settings › Projects shows what `dsh.project.json` declares for the selected project. Plugins that keep a setting of
 * their own per project add a panel here instead of this plugin importing them (docs/plugin-boundaries.md):
 * `@dshfiles/jj-integration` adds the project's main branch. Published as the
 * `@dshfiles/workspace-folder-picker/project-settings-panels` dshx module; importing it loads none of the section.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

/** The project the section has selected. */
export interface ProjectSettingsPanelProps {
  readonly workspaceId: string
  /** The project's sidebar title. */
  readonly name: string
  /** Absolute folder of the project's checkout. */
  readonly path: string
}

export interface ProjectSettingsPanel {
  /** Stable id (`main-branch`). */
  readonly id: string
  /** Lower first, above the declared settings; ties keep registration order. */
  readonly order?: number
  /** The panel for one project; bind it with `plugin.bind(...)`. */
  readonly Panel: ComponentType<ProjectSettingsPanelProps>
}

export const ProjectSettingsPanels = defineRegistry<ProjectSettingsPanel>('@dshfiles/workspace-folder-picker.project-settings-panel')
