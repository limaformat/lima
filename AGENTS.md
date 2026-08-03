# Project instructions

## Source of truth

- This file is the single source of truth for shared project instructions.
- Do not duplicate shared rules in `CLAUDE.md`.
- Update this file when project-wide instructions change.

## Specifications

- `docs/lima-core-1.0-spec.md` and `docs/lima-references-1.0-spec.md` are
  normative and authoritative.
- The specifications are self-contained as of 1.0 Final. No design-history
  document is part of this repository — do not assume one exists or search
  for one.
- Do not modify specification files unless explicitly requested.
- Do not change language semantics merely to satisfy the current implementation.
- Distinguish implementation defects, corpus defects, and specification
  ambiguities.

## Development environment

- Use Bun as runtime, package manager, and test runner.
- Run relevant tests after every meaningful change.

## Git

- Do not create commits unless explicitly requested.
- Do not discard unrelated local changes.
- Keep changes focused on the assigned task.
- Do not weaken or remove tests merely to make the test suite pass.

## Agent workflow

- Claude Code and Codex CLI work alternately, never concurrently writing to
  the same working tree.
- Typical order in this project: Claude Code implements a unit of work,
  then Codex CLI reviews it independently against the specs.
- A reviewing agent reports findings; it does not silently "fix" them
  without confirmation from the human maintainer.
