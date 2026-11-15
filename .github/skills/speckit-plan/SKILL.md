---
name: speckit-plan
description: "Execute the implementation planning workflow using the plan template to generate design artifacts."
user-invocable: true
disable-model-invocation: true
---

Delegates the workflow to the custom agent **speckit.plan**, defined in
`.github/agents/speckit.plan.agent.md`.

To run from a terminal:

    copilot --agent speckit.plan --prompt "<user input>"

When invoked inside a Copilot session, pass the user input from the
invoking message to the named custom agent and relay its result. If the
custom agent is unavailable, read `.github/agents/speckit.plan.agent.md` and follow its
instructions inline.
