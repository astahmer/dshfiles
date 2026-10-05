# Prompt stash

Prompt stash keeps reusable text prompts in this browser's local storage. It adds a Prompts control to the native composer.

Create or edit a saved prompt, then choose Insert. The plugin uses the native revision-guarded insertion API at the cursor captured when the stash opened. It never submits a message and does not replace the current draft. If the draft changes while the stash is open, the insertion is rejected and the user can reopen the stash to choose a fresh position.

The library is versioned, validated, and bounded to 50 prompts, 20,000 characters per prompt, and 450,000 total prompt characters. Concurrent edits from another browser tab are detected by per-prompt revision ids; the local editor remains available and can be saved as a separate copy.

This first increment stores plain text only. It does not save sent-prompt history, references, files, or attachments, and it does not synchronize across browsers or devices.
