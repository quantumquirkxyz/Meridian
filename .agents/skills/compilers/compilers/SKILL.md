# compilers

Design and implement compilers and interpreters — lexer, parser, AST, type checking, code generation, optimization — with correctness and modularity.

## Goals
- Build a correct front-end (lexer → parser → AST)
- Implement type checking or interpretation
- Generate valid output (bytecode, IR, machine code)
- Structure the compiler for extension and testing

## Contract

### Input
A language to compile or interpret: source language, target, feature set.

### Output
A compiler design with:
- Language grammar (EBNF or BNF)
- Module breakdown (lexer, parser, type checker, codegen)
- IR design or bytecode specification
- Test plan for each phase

## Compiler Phases

```
Source → Lexer → Tokens → Parser → AST
                               ↓
                    Semantic Analysis (type check)
                               ↓
                    Optimization (optional)
                               ↓
                    Code Generation → Target
```

## Steps

1. **Define the grammar** — EBNF, ensure it is unambiguous
2. **Implement the lexer** — token stream, handle lexing errors
3. **Implement the parser** — recursive descent, LL(1), or LR
4. **Build the AST** — visitor pattern for traversal
5. **Add semantic analysis** — scope, type checking, symbol table
6. **Generate output** — bytecode, IR, or native code
7. **Add optimization passes** — dead code elimination, constant folding
8. **Write tests** — golden tests, fuzzing, property-based testing

## References
- `../os/SKILL.md` — system calls for code execution
- `../../cs/cs-algorithms/SKILL.md` — parsing algorithms
- `../../math/math-formal-proof/SKILL.md` — correctness proofs
