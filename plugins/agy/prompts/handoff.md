You own this task end to end in the repository at the current working directory.

Requirement:
{{REQUIREMENT}}

Definition of done: the command `{{VERIFY_COMMAND}}` exits 0.
{{TEST_FILES_LINE}}

Rules:
- Read the code you need yourself; follow the repository's existing conventions and libraries.
- Do not modify, delete or skip the test files named above, and do not weaken the verification command.
- Do not add new dependencies unless the requirement says so.
- Do not commit, push or switch branches. Leave your changes uncommitted.
- Run `{{VERIFY_COMMAND}}` yourself before you finish.

When done, reply with at most 10 lines: what you changed (files) and the result of the last verification run.
