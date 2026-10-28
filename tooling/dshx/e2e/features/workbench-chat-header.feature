Feature: Original conversation header inside Workbench

  @scenario:workbench.conversation-header
  @scenario:rich-composer.workbench-header
  @scenario:sidebar-right.workbench-header-opener
  Scenario: Original controls and child views stay bound to each fixed conversation
    Given an isolated Workbench header profile with all original view providers is booted
    When a disposable Workbench workspace has two real threads
    Then each fixed conversation has its original title actions and child-view header
    When the first conversation is moved aside through the restored header opener
    Then both visible headers address their own conversation and Pin and Copy target the first
    And native child views switch independently without replacing the resident editor
    And the header remains usable with its Workbench tab row hidden and after reload
