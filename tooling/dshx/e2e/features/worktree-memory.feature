Feature: Worktree memory (RAM panel)

  The RAM panel reads the real process table. A decoy process started inside
  a registered workspace, whose parent exits at once, is what a leaked dev
  server looks like: init adopts it and it keeps its memory.

  @scenario:worktree-memory.stop-detached-decoy
  Scenario: A detached process inside a workspace is listed, flagged on the sidebar and stopped
    Given the isolated plugin composition of "@dshfiles/worktree-memory, @dshfiles/workspace-folder-picker" is booted
    When a detached decoy process runs inside a registered workspace
    And the RAM panel is opened
    Then the decoy is listed as a detached tree of its workspace
    And the RAM sidebar entry shows the detached memory
    And stopping the decoy from the panel ends the process

  @scenario:worktree-memory.stop-section
  Scenario: A section stop ends every process listed for its workspace
    Given the isolated plugin composition of "@dshfiles/worktree-memory, @dshfiles/workspace-folder-picker" is booted
    When a detached decoy process runs inside a registered workspace
    And the RAM panel is opened
    Then stopping the workspace section from its header ends the process
