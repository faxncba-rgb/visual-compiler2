# Architecture decisions

## ADR-001 — Demonstration is the source of truth

**Status:** Accepted

The compiler preserves the demonstrated page, frame, element fingerprint, and
semantic container. Generalization may introduce bounded control flow but may
not replace a demonstrated target with the first generic role match.

## ADR-002 — Direct compilation precedes AI generalization

**Status:** Accepted

Literal demonstrations compile locally without GPT. The optional AI boundary
accepts redacted structure and explicit instructions, returns structured
semantic output, and is mocked during autonomous development.

## ADR-003 — Runtime is OpenAI-free

**Status:** Accepted

The deterministic runtime has no OpenAI package, API key requirement, or
endpoint access. Static and network-policy tests enforce the boundary.

## ADR-004 — One engine, optional animation

**Status:** Accepted

Animated replay and Run locally load the same compiled artifact into the same
engine. Animation consists only of callbacks and delay; local replay omits it.

## ADR-005 — Automatic dedicated context, manual authentication

**Status:** Accepted

Studio opens a dedicated local persistent Playwright context automatically on
the configured Lab home. Recording begins only after explicit operator action.
The profile lives under `.local/browser-profile/`; profiles and authentication
state are never copied into workflow artifacts.

## ADR-006 — Passing requires evidence; compilation does not

**Status:** Accepted

No run passes solely because actions returned successfully. Strong evidence
produces `PASSED`; successful actions without verifiable evidence produce
`COMPLETED_UNVERIFIED`. Missing evidence does not block compilation or local
execution. Known negative evidence remains a failure.

## ADR-007 — Values and semantics are separate

**Status:** Accepted

Variable definitions belong to the artifact, while runtime values live in a
separate ignored store. Demonstrated values are removed from AI previews unless
the operator explicitly chooses inclusion.

## ADR-008 — Bounded loops only

**Status:** Accepted

Every semantic loop declares a stopping condition, iteration and duration
caps, duplicate fingerprint protection, error policy, and Stop support.

## ADR-009 — Test fixtures are configuration, not product profiles

**Status:** Accepted

Normal Studio exposes no fixture selector. Automated tests supply an explicit
local `VISUAL_COMPILER_TEST_TARGET_URL`; normal Lab Mode defaults to the DPI
home. Test mode rejects non-local targets.

## ADR-010 — One persistent diagnostic representation

**Status:** Accepted

The visible card, copied text, terminal output and local JSONL event log derive
from the same redacted diagnostic object. A failure remains visible until a new
compile or explicit Clear.
