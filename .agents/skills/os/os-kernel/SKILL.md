# os-kernel

Design and analyze operating system internals — process management, memory management, file systems, scheduling, system calls, concurrency — with explicit resource accounting and failure boundaries.

## Goals
- Understand OS abstractions and their implementation trade-offs
- Design system interfaces that are minimal and composable
- Plan for concurrency, scheduling, and resource isolation
- Debug OS-level issues systematically

## Contract

### Input
An OS concept or problem: scheduling, memory management, I/O, concurrency.

### Output
A design or analysis document with:
- OS mechanism description
- Trade-off analysis (performance vs. fairness vs. complexity)
- Implementation considerations
- References to real systems (Linux, BSD, RTOS)

## Core Subsystems

| Subsystem | Responsibility | Key algorithms |
|---|---|---|
| Process management | Create, schedule, terminate | O(1) scheduler, CFS, EDF |
| Memory management | Allocate, virtualize, protect | Paging, slab allocator, GC |
| File system | Persist, organize, retrieve | Ext4, Btrfs, ZFS, FUSE |
| I/O | Device abstraction, buffering | Polling, interrupts, DMA |
| Concurrency | Synchronization, IPC | Mutex, semaphores, RCU |

## Steps

1. **Define the abstraction** — what does the OS expose to programs
2. **Analyze trade-offs** — performance, fairness, complexity, power
3. **Compare implementations** — how does Linux, BSD, or an RTOS do it
4. **Design the interface** — system call design, ioctl conventions
5. **Consider security** — privilege levels, isolation, capability model
6. **Test edge cases** — race conditions, deadlock, resource exhaustion

## References
- `../networking/networking/SKILL.md` — OS networking stack
- `../compilers/compilers/SKILL.md` — code generation for OS targets
- `../../cs/cs-algorithms/SKILL.md` — scheduling, memory algorithms
