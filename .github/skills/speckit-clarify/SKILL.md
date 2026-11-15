---
name: speckit-clarify
description: "Identify underspecified areas in the current feature spec by asking up to 5 highly targeted clarification questions and encoding answers back into the spec."
user-invocable: true
disable-model-invocation: true
---

Delegates the workflow to the custom agent **speckit.clarify**, defined in
`.github/agents/speckit.clarify.agent.md`.

To run from a terminal:

    copilot --agent speckit.clarify --prompt "<user input>"

When invoked inside a Copilot session, pass the user input from the
invoking message to the named custom agent and relay its result. If the
custom agent is unavailable, read `.github/agents/speckit.clarify.agent.md` and follow its
instructions inline.
