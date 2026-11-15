---
name: speckit.taskstoissues
description: "Convert existing tasks into actionable, dependency-ordered GitHub issues for the feature based on available design artifacts."
user-invocable: true
disable-model-invocation: true
---

Delegates the workflow to the custom agent **speckit.taskstoissues**, defined in
`.github/agents/speckit.taskstoissues.agent.md`.

To run from a terminal:

    copilot --agent speckit.taskstoissues --prompt "<user input>"

When invoked inside a Copilot session, pass the user input from the
invoking message to the named custom agent and relay its result. If the
custom agent is unavailable, read `.github/agents/speckit.taskstoissues.agent.md` and follow its
instructions inline.
