# GrowthLoop

LangGraph "AI company" of agents that grows a product's engaged DAU (first product: Viewinter).

**Start here:** read `docs/HANDOFF.md` for the full context: the owner's goals, locked decisions, architecture, status and open questions. `docs/PLAN.md` has the full design.

Rules:
- Never mix mock LLM output into real runs.
- Public or outward actions stay owner-gated. T3 posts are always made by the owner, and T4 always needs approval.
- Ask the owner before enabling the `claude_code` executor or pushing to a product repo.
- `data/` (the SQLite store and checkpoints) and `.env` are local only; never commit them.
- Run with `make dev`, and run `make test` before committing (tests use the mock tier and need no keys).
- UI style follows bullkarma.com. Use the tokens in `frontend/src/styles.css`; don't hard-code colours.
