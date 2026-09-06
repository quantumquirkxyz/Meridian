# qa-automation

Design and implement automated test suites — unit, integration, e2e — with proper coverage, maintainability, and CI integration.

## Goals
- Automate regression tests to enable confident releases
- Choose the right test seam for each scenario
- Keep tests fast, reliable, and deterministic
- Integrate testing into the CI/CD pipeline

## Contract

### Input
A codebase or feature to test: architecture, entry points, risk areas.

### Output
A testing strategy with:
- Test pyramid (unit/integration/e2e proportions)
- Automated test suite with coverage report
- CI integration and failure handling

## Test Pyramid

```
       /\
      /e2e\        ← Few, slow, high confidence
     /------\
    /integr. \    ← Some, medium speed
   /----------\
  /  unit tests \ ← Many, fast, isolated
 /______________\
```

## Steps

1. **Audit the codebase** — entry points, data flows, risk areas
2. **Define the test pyramid** — unit/integration/e2e ratio
3. **Choose testing tools** — match to language and framework
4. **Write tests** — start with happy paths, add edge cases
5. **Make tests reliable** — eliminate flakiness, mock external deps
6. **Integrate with CI** — gate on test results, report coverage
7. **Maintain** — review test suite regularly, remove dead tests

## References
- `../../delivery/tdd/SKILL.md` — test-first development
- `../../delivery/testing/SKILL.md` — test strategy
- `../../delivery/webapp-testing/SKILL.md` — web app testing patterns
- `../../devops/devops-ci-cd-pipeline/SKILL.md` — CI integration
