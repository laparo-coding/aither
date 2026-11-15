---
name: speckit-constitution
description: "Create or update the project constitution from interactive or provided principle inputs, ensuring all dependent templates stay in sync."
user-invocable: true
disable-model-invocation: true
---

Delegates the workflow to the custom agent **speckit.constitution**, defined in
`.github/agents/speckit.constitution.agent.md`.

To run from a terminal:

    copilot --agent speckit.constitution --prompt "<user input>"

When invoked inside a Copilot session, pass the user input from the
invoking message to the named custom agent and relay its result. If the
custom agent is unavailable, read `.github/agents/speckit.constitution.agent.md` and follow its
instructions inline.
