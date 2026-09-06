# interaction-design

Design user interactions — task flows, screen states, transitions, error states, feedback patterns — so the interface guides users predictably.

## Goals
- Map all interaction paths including edge cases
- Provide immediate, visible feedback for every action
- Design graceful error recovery
- Create consistent interaction patterns across the product

## Contract

### Input
A feature or screen to design: user goal, primary flow, error scenarios.

### Output
An interaction design specification with:
- Happy path and alternative paths
- Screen states (empty, loading, error, success)
- Transition and feedback patterns
- Accessibility requirements

## Patterns

| Pattern | Trigger | Feedback |
|---|---|---|
| Optimistic update | User action | Immediate UI change, async confirmation |
| Progressive disclosure | User exploration | Step-by-step information reveal |
| Confirmation dialog | Destructive action | Explicit accept/cancel |
| Inline validation | Form input | Real-time error/success message |
| Skeleton screen | Async load | Layout preview before content |

## Steps

1. **Define the goal** — what is the user trying to accomplish
2. **Map the happy path** — primary interaction sequence
3. **Identify branches** — error states, empty states, alternative flows
4. **Choose patterns** — match interaction patterns to context
5. **Design feedback** — what does the user see at each step
6. **Review** — walk through the interaction as a user

## References
- `../ux-research/SKILL.md` — grounding design in research
- `../../frontend/frontend-design/SKILL.md` — visual and interaction system
- `../../accessibility/accessibility/SKILL.md` — inclusive interactions
