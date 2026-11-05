Feature: Backlog planning

  Acceptance criteria, templates, due dates, duplicate merge, recurring items
  and per-project agent guidance: structure an item carries in fields of its
  own, and what agents read from it. Every scenario uses a fresh isolated
  profile.

  @scenario:backlog.acceptance-criteria
  Scenario: Acceptance criteria check off one by one and roll up on the item and its row
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Ship structured sections" is captured as a work item
    And backlog item b:1 is opened
    And the criteria "Stored as fields, Editable in the peek, Searchable" are added in the inspector
    And the criterion "Stored as fields" is checked in the inspector
    Then the inspector shows criteria progress "1/3"
    And the Items view row of b:1 shows criteria "1/3"

  @scenario:backlog.template-capture
  Scenario: A capture written with /template starts from the Bug report template
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Login fails on Safari /template Bug report" is captured as a work item
    And backlog item b:1 is opened
    Then the inspector shows b:1 as a "Bug" titled "Login fails on Safari" with criteria progress "0/3" and the template body

  @scenario:backlog.due-overdue
  Scenario: A due date set in the inspector shows on the row, and an overdue item lands in the Inbox
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Renew the certificate" is captured as a work item
    And "File the expense report" is captured as a work item
    And b:2 was due yesterday
    And backlog item b:1 is opened
    And its due date is set to "Tomorrow" in the inspector
    Then the Items view row of b:1 shows the due chip "Tomorrow"
    When the Inbox is opened on its "Overdue" tab
    Then the Inbox lists "File the expense report" as overdue

  @scenario:backlog.duplicate-merge
  Scenario: Merging a duplicate drops it, moves its comment, and its reference opens the survivor
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Composer drops chips" is captured as a work item
    And "Chips vanish on paste" is captured as a work item
    And b:2 has the comment "seen on Safari too"
    And b:2 is merged into b:1 from its context menu
    Then b:2 is dropped as a duplicate of b:1
    And the reference b:2 opens b:1 with the moved comment

  @scenario:backlog.recurrence-next
  Scenario: Finishing a weekly item creates its next occurrence
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Water the plants" is captured as a work item
    And backlog item b:1 is opened
    And it is set to repeat "Weekly" in the inspector
    And its status is set to "Done" in the inspector
    Then a new "Water the plants" item waits in Todo, due in a week

  @scenario:backlog.project-guidance-start
  Scenario: A thread started from an item opens with its project's agent guidance
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And the project folder "guided" has the agent guidance "Run pnpm fmt before describing a revision."
    And "Tidy the formatter" is captured in the project folder "guided"
    And a thread is started for b:1 through the backlog API
    Then the started thread's first message opens with "Project guidance for" and "Run pnpm fmt before describing a revision."

  @scenario:backlog.gates-ready
  Scenario: A date gate keeps an item out of the Ready view, and a PR link stays a plain link without the pull-requests plugin
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Launch after the freeze" is captured as a work item
    And backlog item b:1 is opened
    And a "Date reached" gate for tomorrow is added in the inspector
    And the pull request "https://github.com/astahmer/dshfiles/pull/579" is linked in the inspector
    Then the inspector shows one open gate and the pull request as a plain link
    When the Ready view is opened
    Then the Ready view has no item
    When backlog item b:1 is opened
    And the gate is removed in the inspector
    And the Ready view is opened
    Then the Ready view finally lists "Launch after the freeze"

  @scenario:backlog.scheduled-rule-absent
  Scenario: Scheduling a nightly triage without Project automations says how to enable it
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Triage the inbox nightly" is captured in the project folder "nightly"
    And backlog item b:1 is opened from the Items view
    And "Schedule nightly triage" is chosen from the context menu of b:1
    Then a notice says to enable Project automations or use automation_save
