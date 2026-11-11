Feature: Phone pairing from the sidebar

  The sidebar footer carries the pairing QR button phone-pairing provides. Phone
  access stays off until the user enables it, so the popover says how to turn it
  on instead of minting a code no tunnel can serve.

  @scenario:phone-pairing.sidebar-qr-off
  Scenario: The sidebar's pairing QR explains how to enable phone access while it is off
    Given the isolated plugin composition of "@dshfiles/phone-pairing, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat" is booted
    When the pairing QR code is opened from the sidebar footer
    Then the phone pairing popover says phone access is off and mints no code
