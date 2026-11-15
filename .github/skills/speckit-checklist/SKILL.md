---
name: speckit-checklist
description: "Generate a custom checklist for the current feature based on user requirements."
user-invocable: true
disable-model-invocation: true
---

Delegates the workflow to the custom agent **speckit.checklist**, defined in
`.github/agents/speckit.checklist.agent.md`.

To run from a terminal:

    copilot --agent speckit.checklist --prompt "<user input>"

When invoked inside a Copilot session, pass the user input from the
invoking message to the named custom agent and relay its result. If the
custom agent is unavailable, read `.github/agents/speckit.checklist.agent.md` and follow its
instructions inline.
