Feature: Resource packs

  Referenced resources keep their native owner. Reusable typed packs add local
  metadata only; no action here reads file contents, sends a model request or
  starts an agent.

  @scenario:resource-packs.browser-journey
  Scenario: Reuse a typed pack on a conversation and a file without losing values
    Given the isolated plugin profile "@dshfiles/resource-packs" is booted
    When the Resources page is opened
    And a resource "Review conversation" references "dsh" "conversation" "fixture-thread"
    And the Tracking pack is attached to resource "Review conversation"
    And the Tracking values of "Review conversation" are saved as assignee "Alex" and due date "2026-11-05"
    Then the resource table shows "Review conversation" with "Alex"
    When a resource "Review document" references "filesystem" "file" "/synthetic/review.md"
    And the Tracking pack is attached to resource "Review document"
    And the Tracking values of "Review document" are saved as assignee "Sam" and due date "2026-11-06"
    Then the resource table shows "Review document" with "Sam"
    When the Resources page is reloaded
    Then the resource table shows "Review conversation" with "Alex"
    And the resource table shows "Review document" with "Sam"
    When the Tracking pack is detached from resource "Review conversation" with confirmation
    And the Tracking pack is attached to resource "Review conversation"
    Then the resource editor retains "Alex" and "2026-11-05"
    And the Resources journey has no browser errors

  @scenario:resource-packs.custom-pack
  Scenario: Define a pack in the GUI and attach it to a referenced resource
    Given the isolated plugin profile "@dshfiles/resource-packs" is booted
    When the Resources page is opened
    And a Review pack with a Reviewer text property is created
    And a resource "Custom review" references "filesystem" "file" "/synthetic/custom.md"
    And the Review pack is attached to resource "Custom review"
    And resource "Custom review" is assigned reviewer "Taylor"
    Then the resource table shows "Custom review" with "Taylor"
    When the Resources page is reloaded
    And the Review pack is selected
    Then the resource table shows "Custom review" with "Taylor"
    And the Resources journey has no browser errors
