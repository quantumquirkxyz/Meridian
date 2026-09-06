# quirk Method Fundamentals

## Learning Path Level 1: Understanding the Core Principles

### The 8 Principles of the quirk Method

1. **Context before action**
   - Always build a fresh context pack before engaging in broad work
   - Prefer repository documentation, ADRs, issue tracker state, and direct code evidence over memory
   - This prevents working with stale or incorrect assumptions

2. **Questions before commitments**
   - Use grill or grill-with-docs when work is ambiguous
   - Decisions are made with the user, not guessed
   - This prevents building the wrong thing

3. **Artifacts over vibes**
   - Specs, tickets, PR bodies, review plans, implementation notes, ADRs, and handoffs must be durable
   - Each artifact shape should belong to the skill that emits it
   - This ensures work can be continued by other agents or humans

4. **Vertical slices over horizontal dumps**
   - Tickets should be narrow, complete paths through behavior, validation, and delivery
   - This enables true parallelism and reduces blocking dependencies
   - Each ticket should be independently claimable and completable

5. **Measurement before repair**
   - review-pr measures Standards and Spec separately
   - plan-review-fixes plans
   - implement-review-fixes executes
   - ship-subissue ships
   - This prevents conflating measurement with repair activities

6. **Branch-state before repair**
   - If a PR branch is conflicted, resolve that branch-state problem first with resolving-merge-conflicts
   - Then return to review and repair
   - This ensures we're working with a clean base

7. **Repo-local specialization**
   - Each project owns its own domain language, tracker configuration, commands, and risk boundaries
   - This prevents leaking another project's domain into the current context
   - Specialization happens through CONTEXT.md, ADRs, issue tracker docs, validation commands, and stack-specific skills

8. **Fail closed on uncertainty**
   - Missing fixed points, stale plans, unclear issue traceability, unresolved blockers, and skipped validation must be surfaced
   - Rather than making assumptions, the system stops and requests clarification
   - This prevents silent failures and wrong directions

### Core Vocabulary

Familiarize yourself with these key terms:

- **Context pack**: A bounded set of fresh reads and provenance that gives the next skill enough evidence to act
- **Domain language**: The project's chosen terms, recorded in CONTEXT.md and ADRs
- **Seam**: The public boundary where design, implementation, testing, or operations become explicit
- **Tracer bullet**: A ticket that makes one narrow end-to-end behavior work
- **Frontier**: Tickets that are unblocked and claimable now
- **Review axis**: One of the two independent review dimensions: Standards and Spec
- **Repair plan**: A durable PR comment that converts findings into scoped, validated fixes
- **Ship state**: The state where review is clean, validation is known, and linked work can be merged or completed

### The Canonical Flow

The standard workflow for feature development:

```
setup-quirk-skills
→ ask-to
→ grill-with-docs
→ to-spec
→ to-tickets
→ implement
→ publish-open-pr
→ review-pr
→ review-fix-loop (when needed)
→ ship-subissue (after clean review)
```

### Quality Bar

A quirk artifact is acceptable when it answers these questions:

1. What is the source of truth?
2. What is in scope?
3. What is explicitly out of scope?
4. Who or what consumes this artifact next?
5. What evidence proves it is done?
6. What risk remains?

If an artifact cannot answer these questions, improve it before routing it downstream.

### Exercises

1. **Context Pack Practice**: 
   - Pick a task in your current project
   - Build a context pack using the context-pack skill
   - Document what you read and why

2. **Grilling Practice**:
   - Take an ambiguous idea or plan
   - Use the grill skill to question it relentlessly
   - Record the clarified decisions and recommended answers

3. **Artifact Analysis**:
   - Look at a recent PR in your project
   - Identify which artifacts were created and which skills likely produced them
   - Evaluate the artifacts against the quality bar questions

4. **Principle Identification**:
   - Observe a recent workflow in your team
   - Identify which of the 8 principles were followed and which were violated
   - Document the consequences of any violations

### Next Steps

After mastering these fundamentals, proceed to:
- Level 2: Writing effective skills (using writing-great-skills)
- Level 3: Building implementation skills (using tdd and implement)
- Level 4: Creating platform and stack specialized skills
- Level 5: Designing new workflow patterns

Remember: The goal is not memorization but internalization. These principles should become second nature in your agent-assisted development practice.