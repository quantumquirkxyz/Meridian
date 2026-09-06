# Writing Effective quirk Skills

## Learning Path Level 2: Skill Authoring Mastery

### Beyond Basic Syntax: The Art of Predictable Skills

Creating effective quirk skills is less about following syntax rules and more about cultivating predictability in agent behavior. This guide builds on the fundamentals to teach you how to create skills that agents can rely on.

### The Predictability Principle

Remember: **Predictability** — the agent taking the same _process_ every run, not producing the same output — is the root virtue; every lever below serves it.

This means we optimize for consistent _behavior_, not consistent outputs. A skill is predictable if, given the same inputs and context, an agent will follow the same steps to reach a conclusion, even if the specific conclusion varies based on the situation.

### Core Authoring Principles

#### 1. Front-Load the Leading Word
A **leading word** is a compact concept already living in the model's pretraining that the agent thinks with while running the skill.

Examples of effective leading words: _relentless_, _tight_, _fog of war_, _tracer bullets_, _leverage_, _locality_

- Put the leading word early in your description where it does its invocation work
- Repeat it throughout the skill to anchor execution
- Use it in your description to anchor invocation

#### 2. Embrace Progressive Disclosure
Keep SKILL.md lean by pushing details behind context pointers:

- **In-skill step**: Primary tier - what the agent does, in order
- **In-skill reference**: Consulted on demand - definitions, rules, facts
- **External reference**: Loaded only when pointer fires - detailed examples, schemas

**Linked files should be named for what they hold** (this skill discloses its full definitions to GLOSSARY.md)

#### 3. Practice Ruthless Pruning
- Keep each meaning in a **single source of truth**
- Check every line for **relevance**: does it still bear on what the skill does?
- Hunt **no-ops** sentence by sentence: run the no-op test on each sentence in isolation
- Be aggressive — most prose that fails should go, not be rewritten

#### 4. Master Information Hierarchy
Understand the ladder of immediate need:

1. **In-skill step** - ordered actions, primary tier (what agent does)
2. **In-skill reference** - definitions, rules, facts (consulted on demand)
3. **External reference** - pushed out to separate files, loaded on demand

A demanding completion criterion drives thorough legwork — the digging the agent does within the work.

### Advanced Contract Design

#### Inputs and Outputs Semantics
Go beyond listing inputs and outputs — design them for meaningful composition:

- **Inputs** should represent what the skill truly needs to function
- **Outputs** should represent what the skill genuinely produces
- Consider how your skill's outputs become inputs for other skills
- Design for the "next consumer" of your artifacts

#### Dependencies as Trust Boundaries
- Dependencies declare what other skills you trust to provide certain capabilities
- They should be minimal and intentional
- Each dependency represents a trust boundary in your skill's execution
- Circular dependencies indicate design problems that need refactoring

#### Side Effects as Honesty Contracts
Side effects declare what repository state your skill modifies:

- Be exhaustive and honest about modifications
- Use the execution-policy framework to categorize actions
- Consider rollback paths for modifying side effects
- Align declared risk with actual potential impact

### The Art of the Description

Your skill's description serves two jobs when model-invoked:
1. State what the skill is
2. List the branches that should trigger it

#### Description Writing Rules:
- **Front-load the skill's leading word**
- **One trigger per branch** - avoid duplication
- **Cut identity that's already in the body**
- Keep description to triggers plus any "when another skill needs..." reach clause

### Designing for Evaluation

Think about how your skill will be evaluated from the start:

#### For Scenario Testing:
- What are the expected routes through skills for common use cases?
- What static assertions can validate skill behavior?
- What would constitute a regression in your skill's behavior?

#### For Behavioral Testing:
- What artifact formats should your skill consistently produce?
- What sections are required in those artifacts?
- What placeholder text should be forbidden?

### Common Pitfalls and How to Avoid Them

#### Pitfall 1: The Kitchen Sink Skill
**Problem**: Trying to do too much in one skill
**Solution**: Split by invocation (distinct leading words) or by sequence (preventing premature completion)

#### Pitfall 2: The Vague Stop Condition
**Problem**: Agent can't tell when the skill is done
**Solution**: Make completion criteria checkable and exhaustive
- Bad: "do a thorough job"
- Good: "the acceptance criteria are satisfied in the repo state and validated locally"

#### Pitfall 3: The Hidden Dependency
**Problem**: Skill implicitly relies on something not declared
**Solution**: Make all dependencies explicit in the frontmatter
- If you need CONTEXT.md vocabulary, say so
- If you modify specific files, declare the side effect

#### Pitfall 4: The Narrative Trap
**Problem**: Writing prose that doesn't change agent behavior
**Solution**: Apply the no-op test - does removing this line change behavior?
- If not, delete it
- If yes but only emotionally, strengthen the leading word instead

### Template for Effective Skills

Here's what an excellently designed quirk skill looks like:

```
---
name: my-skill
description: Clear, leading-word-rich description that states what it does and when to use it.
version: 1
capabilities:
  - specific-capability-name
  - another-capability
inputs:
  - clear-input-description
  - another-input
outputs:
  - clear-output-description
  - another-output
dependencies:
  - only-what-you-truly-need
sideEffects:
  - honest-modifications-only
stopCondition: Clear, checkable completion criteria that ties to observable outcomes.
risk: honest-assessment
---

# Skill Name

Start with purpose and boundary - what this skill does and doesn't do.

## Contract

Explicitly state:
- Input: what the skill consumes
- Output: what the skill produces
- Scope: what the skill does and doesn't do
- Rules: specific constraints that govern the skill's behavior

[Optional: Sections specific to your skill's purpose]

## Completion Criteria

Clear, observable criteria that tell when the skill is done.
Each criterion should be checkable by the agent.
```

### Exercises

1. **Leading Word Hunt**:
   - Take an existing skill and identify its leading word(s)
   - How could you make them more prominent or effective?
   - Practice front-loading them in the description

2. **No-Op Application**:
   - Take a skill paragraph and apply the no-op test to each sentence
   - Delete sentences that don't change behavior when removed
   - Strengthen weak leading words instead of rewriting

3. **Contract Design**:
   - Design a skill for a common task in your domain
   - Explicitly define inputs, outputs, dependencies, and side effects
   - Trade off different design choices and justify your decisions

4. **Evaluation Planning**:
   - For your skill design, plan what scenario fixtures would test
   - Plan what behavioral fixtures would validate outputs
   - Think about how to make your skill reliably testable

### Next Steps

After mastering skill authoring, proceed to:
- Level 3: Building implementation skills that create lasting value
- Level 4: Creating platform skills that shape technical decisions
- Level 5: Designing workflow patterns that orchestrate complex processes

Remember: The best quirk skills aren't the most feature-rich—they're the ones that agents can rely on to do the same thoughtful process every time, producing artifacts that other skills can depend on.