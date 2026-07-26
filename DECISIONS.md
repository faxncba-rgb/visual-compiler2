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

## ADR-005 — Local persistent context, manual authentication

**Status:** Accepted

Playwright uses a local persistent context. Recording is disabled through the
authentication state and begins only after explicit operator action. Profiles
and authentication state are never copied into workflow artifacts.

## ADR-006 — Positive outcome required

**Status:** Accepted

No run passes solely because actions returned successfully. A compiled outcome
must contain positive evidence and negative error evidence. Missing positive
evidence is failure.

## ADR-007 — Values and semantics are separate

**Status:** Accepted

Variable definitions belong to the artifact, while runtime values live in a
separate ignored store. Demonstrated values are removed from AI previews unless
the operator explicitly chooses inclusion.

## ADR-008 — Bounded loops only

**Status:** Accepted

Every semantic loop declares a stopping condition, iteration and duration
caps, duplicate fingerprint protection, error policy, and Stop support.
