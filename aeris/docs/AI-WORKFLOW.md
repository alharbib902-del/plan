# Aeris AI Execution Workflow

This file defines how the project owner, Claude Opus, and Codex review work together.

## Roles

### Project Owner
- Chooses the current phase.
- Sends Claude the current task file.
- Sends Codex the execution log and changed files for review.
- Approves moving to the next phase.

### Claude Opus
- Reads `docs/CLAUDE-TASK.md`.
- Implements only the current task.
- Updates `docs/CLAUDE-WORK-LOG.md` after finishing.
- Does not move to the next phase unless the task says so.

### Codex Advisor
- Reviews Claude's implementation.
- Checks product fit, code quality, security, UX, and build health.
- Writes acceptance percentage and required fixes in `docs/CODEX-REVIEW.md`.
- Decides whether the task is accepted, needs revision, or should be split.

## Execution Loop

1. Codex writes or updates `docs/CLAUDE-TASK.md`.
2. Project Owner gives Claude Opus this instruction:

```text
Read docs/AI-WORKFLOW.md and docs/CLAUDE-TASK.md.
Implement only the current task.
After finishing, update docs/CLAUDE-WORK-LOG.md with what changed, files changed, tests run, and blockers.
Do not proceed to the next phase.
```

3. Claude implements the task.
4. Project Owner sends Codex:
   - Claude's work log
   - changed files
   - build/type-check/lint results
   - screenshots if UI changed
5. Codex reviews and updates `docs/CODEX-REVIEW.md`.
6. If accepted, Codex writes the next task.
7. If not accepted, Codex writes a revision task for Claude.

## Acceptance Scale

- 90-100%: Accepted. Minor polish only.
- 75-89%: Mostly accepted. Needs small fixes before next phase.
- 50-74%: Needs revision. Do not move forward.
- 0-49%: Rework required. Scope or implementation is off track.

## Non-Negotiable Rules

- Web-first responsive platform. No mobile app yet.
- Build one phase at a time.
- Do not add features outside the task.
- Keep WhatsApp as the main operating channel during MVP.
- Keep admin control in the loop for offers, operators, and bookings.
- Do not store secrets in the repository.
- Run at least type-check and build when possible.

