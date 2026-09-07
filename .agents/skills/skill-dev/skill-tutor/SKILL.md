---
name: skill-tutor
category: skill-dev
maturity: stable
version: 1
description: Interactive tutorial that guides users through creating their first quirk skill using structured worksheets and hands-on
---

# Skill Tutor: Interactive Guide to Creating Your First quirk Skill

This skill provides an interactive, worksheet-based tutorial that guides you through creating your first quirk skill using hands-on practice and structured learning.

## Contract

- Input: learning goal, preferred skill type, available time
- Output: completed tutorial worksheet, created skill in sandbox, learning validation, personalized learning path
- Scope: guided first experience creating a quirk skill
- Rule: learning by doing - you will create an actual skill during the tutorial
- Rule: all skills created follow the quirk method and can be validated using existing tools
- Rule: tutorial adapts to your background and goals while teaching core concepts

## Interactive Tutorial Process

This tutorial uses the principle of "progressive disclosure" for learning - revealing complexity gradually as you build foundational skills.

### Phase 1: Foundation Building (15-20 minutes)

#### Worksheet 1.1: Understanding Skills
```
What is a skill in the quirk method? (In your own words)
_________________________________________________________
_________________________________________________________

What makes a skill predictable? (Hint: think about the root virtue)
_________________________________________________________
_________________________________________________________

Name one principle of the quirk method and explain why it matters:
Principle: _______________________________________________
Explanation: ____________________________________________
_________________________________________________________
```

#### Worksheet 1.2: Skill Anatomy Exploration
```
Examine an existing simple skill (like context-pack or ask-to):

What does this skill do in one sentence? ___________________
_________________________________________________________

What are its inputs? _____________________________________
What are its outputs? ____________________________________

What does it declare as side effects? ______________________
What is its stop condition? _______________________________
```

### Phase 2: Guided Creation (30-45 minutes)

#### Worksheet 2.1: Choosing Your First Skill Project
```
Think of a small, repetitive task you do when working with code.
Examples: checking file naming conventions, validating TODO comments, 
ensuring consistent imports, etc.

What small task would you like to automate with a skill?
_________________________________________________________

Why is this task a good candidate for a skill? (Repeated, predictable, bounded)
_________________________________________________________
_________________________________________________________

Who would benefit from this skill? ________________________
_________________________________________________________
```

#### Worksheet 2.2: Defining Your Skill Contract
```
Skill Name (use kebab-case): ____________________________
One-sentence description (what it does and when to use it):
_________________________________________________________
_________________________________________________________

Inputs (what your skill needs to work):
- ________________________________________
- ________________________________________

Outputs (what your skill produces):
- ________________________________________
- ________________________________________

Side Effects (what repository state it modifies, be honest):
- ________________________________________
- ________________________________________

Stop Condition (how you'll know when it's done - be specific!):
_________________________________________________________
_________________________________________________________
```

#### Worksheet 2.3: Building Your Skill
Follow these steps to create your skill:

1. Open your terminal and navigate to the skill-sandbox:
   ```
   cd .skill-sandbox
   ```

2. Create your skill directory:
   ```
   mkdir -p <your-skill-name>
   cd <your-skill-name>
   ```

3. Create the SKILL.md file with this template:
   ```
   ---
   name: <your-skill-name>
   description: <your one-sentence description>
   version: 1
   capabilities:
     - <main-capability-name>
   inputs:
     - <input-1-description>
     - <input-2-description>
   outputs:
     - <output-1-description>
     - <output-2-description>
   dependencies: []
   sideEffects:
     - <side-effect-from-above>
   stopCondition: <your-stop-condition-from-above>
   risk: low
   ---

   # <Your Skill Name>

   [Write a brief explanation of what this skill does and doesn't do]

   ## Contract

   - Input: [describe what the skill consumes]
   - Output: [describe what the skill produces]
   - Scope: [brief description of what this skill does and doesn't do]
   ```

4. Test that your skill has the right structure:
   ```
   cd ..
   node .skill-sandbox/validations/validate-sandbox-skills.mjs
   ```
   Should show 1 skill detected with no errors.

### Phase 3: Validation and Reflection (15-20 minutes)

#### Worksheet 3.1: Testing Your Understanding
```
Explain in your own words:
What is the difference between inputs and outputs in a skill?
_________________________________________________________
_________________________________________________________

Why should side effects be declared honestly?
_________________________________________________________
_________________________________________________________

What makes a good stop condition?
_________________________________________________________
_________________________________________________________
```

#### Worksheet 3.2: Using the Skill Creator Skill
```
Now that you've created a skill manually, let's see how the skill-creator skill can help.

The skill-creator skill provides worksheets to help you design skills more systematically.
Try running it with a different skill concept to see how it works.

What did you notice about the skill-creator approach vs. creating manually?
_________________________________________________________
_________________________________________________________
```

#### Worksheet 3.3: Reflection and Next Steps
```
What was the most challenging part of creating your first skill?
_________________________________________________________
_________________________________________________________

What was the most surprising thing you learned?
_________________________________________________________
_________________________________________________________

What type of skill would you like to create next?
_________________________________________________________

What is one question you still have about skills or the quirk method?
_________________________________________________________
_________________________________________________________
```

## Learning Path Integration

This tutorial connects to the broader quirk learning ecosystem:

### After Completing This Tutorial:
- You have practical experience creating a skill
- You understand the basic structure and contracts
- You know how to validate skills using sandbox tools

### Recommended Next Steps:
1. **Use skill-creator for your next skill**: Try the structured worksheets approach
2. **Explore the learning path**: Review `docs/agents/learning-path/01-fundamentals.md` and `02-writing-effective-skills.md`
3. **Try creating a skill that solves a real problem**: Apply what you learned to an actual need in your workflow
4. **Learn about skill composition**: Study how skills work together in workflows (see wayfinder, to-spec, to-tickets, etc.)

## Completion Criteria

The user has completed this skill when:

- They have filled out all worksheets with thoughtful responses
- They have created a valid skill in the .skill-sandbox/ directory
- They have successfully validated their skill using the sandbox validation tools
- They have reflected on their learning experience and identified next steps
- They can explain the basic concepts of skills in the quirk method

## Guardrails

- Focus on learning by doing - the goal is to create an actual skill, not just theory
- Keep your first skill small and focused - better to do one thing well than many things poorly
- Be honest in your self-assessment - identify what you don't know as well as what you do
- Remember that the first skill doesn't need to be perfect - it needs to be a learning experience
- Use the validation tools to check your work, but don't rely on them exclusively for learning