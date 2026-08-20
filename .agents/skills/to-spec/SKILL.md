---
name: to-spec
description: Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed.
disable-model-invocation: true
version: 1
capabilities:
  - synthesize-spec
  - publish-spec
inputs:
  - current conversation context
  - codebase understanding
  - repo conventions
outputs:
  - spec issue
  - implementation decisions
  - testing decisions
dependencies:
  - context-pack
  - capability-router
  - work-item-router
  - grill-with-docs
  - domain-modeling
sideEffects:
  - write-issue
stopCondition: The spec is published and the implementation decisions are explicit.
risk: medium
---

This skill takes the current conversation context and codebase understanding and produces a spec (you may know this document as a PRD). Do NOT interview the user — just synthesize what you already know. Write the published issue body in English, and use the repo's Quant vocabulary consistently.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.
The canonical work-item metadata shape is documented in [`docs/agents/work-item-format.md`](../../../docs/agents/work-item-format.md); follow it for labels, milestone, project, fields, and todo/acceptance structure.

## Contract

- Input: current conversation context, codebase understanding, and repo conventions.
- Output: one published spec issue plus the implementation and testing decisions that make the work buildable.
- Scope: synthesize what is already known; do not reopen discovery interviews.
- Rule: prefer one seam, and make any seam choice explicit before publishing.
- Rule: frame the work in terms of Quant concepts where relevant: context, harness, loop, graph, data plane, execution plane, observability, and safety boundaries.
- Rule: if the spec cannot be made concrete enough to hand off, stop and say what is still missing.

## Process

1. Build a minimal fresh context pack before broad exploration. Route the task against declared capabilities so the work shape is explicit before you draft the spec. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Check with the user that these seams match their expectations.

3. Write the spec using the template below, then publish it to the project issue tracker. Apply the repo defaults from `docs/agents/issue-tracker.md`: for this repo that means labels `spec` plus `ready-for-agent` - no need for additional triage. The entire published issue, including headings, user stories, and notes, must be in English. Also apply the work-item format defaults: set the milestone when one is known, add the issue to the matching project board when relevant, and keep the todo/acceptance content aligned with the metadata.

## Completion criteria

- the problem and solution are stated from the user's perspective
- implementation decisions are concrete enough to guide ticketing
- testing decisions identify external behavior and the intended seam
- scope and out-of-scope items are explicit
- the spec is published with the tracker defaults applied

<spec-template>

## Metadata

- Labels: `spec`, `ready-for-agent`
- Milestone: <phase milestone or none>
- Project: <project board or none>
- Fields: Work Type = Epic; Repo Scope = <scope>; Phase = Ready for build; Priority = <priority>; Risk = <risk>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>
