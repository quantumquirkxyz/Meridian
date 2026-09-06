---
name: math-linear-algebra
category: skill-dev/sandbox
maturity: experimental
version: 1
description: Solve and analyse linear algebra problems — matrix decompositions (LU, QR, SVD, eigendecomposition), linear systems, and applications in ML, graphics, and optimisation.
capabilities:
  - execute the core process defined in the skill body
  - produce a Markdown artifact satisfying completion criteria
outputs:
  - Markdown artifact with all process steps completed
sideEffects: []
dependencies: []
stopCondition: All process steps executed; artifact saved with all required sections present.
risk: low
trustTier: 1
maxIterations: 6
---

## Contract

- **Input:** problem description and inputs defined by the skill body.
- **Output:** Markdown artifact with completed process steps.
- **Side effects:** none.
- **Dependencies:** none.
- **Stop condition:** all process steps executed; artifact saved with required sections.
- **Risk:** low.
- **Boundary:** produces reasoning artifact only; no system changes.


# Linear Algebra

Apply **linear algebra** — decompositions, solving systems, transformations — with explicit numerical stability and interpretation.

## When to use

- User needs a matrix decomposition, linear system solved, or eigenproblem.
- ML, graphics, optimisation, or signal processing needs a linear-algebra backbone.
- Numerical stability of a computation is in question.

## Process

1. Identify problem type — linear system Ax = b, eigenvalue problem Ax = λx, SVD, least squares, PCA, or transformation.
2. State matrix properties: shape, rank, symmetry, positive-definiteness, sparsity.
3. Choose decomposition / method — LU (stable for well-conditioned), Cholesky (SPD), QR (least-squares), SVD (rank-deficient / ill-posed), eigendecomposition (diagonalisation).
4. Compute — with explicit pivoting strategy and condition number estimate.
5. Validate — residual ||Ax−b||, orthogonality of eigenvectors, singular values non-negative, backward error.
6. Interpret — in the problem domain (e.g. SVD: principal components, condition number → sensitivity; eigenvalues: stability of dynamical system).
7. Deliver — artifact with matrix properties, decomposition chosen, computation, residual/validation, and domain interpretation.
