# Decisions Log

This folder contains a transparent record of significant engineering decisions made during development.

## Purpose

When Claude makes autonomous decisions (instead of asking the user), those decisions are logged here with:
- The context that required a decision
- Options that were considered
- The reasoning for the choice made
- How to reverse the decision if needed

## When to Review

Check this folder when:
- Something doesn't work as expected
- You're wondering "why was it done this way?"
- You want to reverse a decision
- Onboarding new team members

## File Naming Convention

- `[topic].md` - Decisions grouped by feature/system
- `dead-code-YYYY-MM-DD.md` - Dead code removal logs
- `architecture-[topic].md` - Architectural decisions

## Reversibility Levels

- **Easy**: Change a config value or constant
- **Medium**: Modify a few files, may need testing
- **Hard**: Significant refactoring required, affects multiple systems
