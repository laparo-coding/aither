---
name: speckit-implement
description: "Execute the implementation plan by processing and executing all tasks defined in tasks.md"
user-invocable: true
disable-model-invocation: true
---

Delegates the workflow to the custom agent **speckit.implement**, defined in
`.github/agents/speckit.implement.agent.md`.

To run from a terminal:

    copilot --agent speckit.implement --prompt "<user input>"

When invoked inside a Copilot session, pass the user input from the
invoking message to the named custom agent and relay its result. If the
custom agent is unavailable, read `.github/agents/speckit.implement.agent.md` and follow its
instructions inline.
