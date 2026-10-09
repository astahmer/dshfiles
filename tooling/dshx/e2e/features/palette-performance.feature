Feature: Palette and stylesheet performance budget

  Every @dshfiles plugin once injected its own copy of the same 116 KB Tailwind
  sheet, which multiplied style recalculation, and the thread palette re-rendered
  the whole sidebar on open. These budgets are twice the Phase 0 targets in
  plans/ade/README.md so a regression fails before it is felt.

  Background:
    Given the web profile is booted

  Scenario: The @dshfiles plugins share one stylesheet
    Then exactly one shared plugin stylesheet is injected

  Scenario: The command palette opens and filters within budget
    Then the command palette opens within 100 ms and filters each keystroke within 32 ms
