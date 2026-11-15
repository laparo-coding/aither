---
name: speckit.tasks
description: "Generate an actionable, dependency-ordered tasks.md for the feature based on available design artifacts."
user-invocable: true
disable-model-invocation: true
---

Delegates the workflow to the custom agent **speckit.tasks**, defined in
`.github/agents/speckit.tasks.agent.md`.

To run from a terminal:

    copilot --agent speckit.tasks --prompt "<user input>"

When invoked inside a Copilot session, pass the user input from the
invoking message to the named custom agent and relay its result. If the
custom agent is unavailable, read `.github/agents/speckit.tasks.agent.md` and follow its
instructions inline.
