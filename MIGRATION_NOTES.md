# Migration notes

The Visual Compiler 1 repositories were inspected read-only before Visual
Compiler 2 was created. No codebase was cloned and no predecessor working tree
was changed.

## Concepts reused

- The compile-time/runtime isolation boundary and invariant telemetry
  `llmCalls: 0`, `openAIRequests: 0`.
- Zod validation at the Semantic IR boundary.
- Ranked semantic locators with a refusal threshold.
- Canonical URL handling and query-parameter redaction.
- Runtime-side positive final-state checks instead of treating a Playwright
  action as proof of success.
- Local artifact persistence, versioned workflow IDs, and a Git-ignored browser
  profile.
- Local synthetic fixtures, runtime OpenAI-domain blocking, and static
  no-OpenAI-import tests.
- Geometry and neighboring-label evidence as fallbacks after stronger
  accessibility evidence.

## Rewritten

- Capture is now a real user demonstration recorder rather than an
  instruction-first page snapshot.
- The Demonstration IR records pages, frames, popup lifecycles, exact target
  evidence, observed effects, and local value references.
- Page targets form a graph with stable session IDs and opener relationships;
  page array order is not an identity.
- The direct compiler requires no GPT for literal sequences.
- Local values are separated from both semantic artifacts and the optional AI
  payload by default.
- Runtime attaches to the existing managed session so manual authentication can
  continue without serializing credentials.
- Animated replay is a presentation callback on the same runtime, not a
  separate execution path or prerequisite.

## Failures that shaped the design

Visual Compiler 1 could interpret an instruction for a consultation editor and
select `role=textbox >> nth=0`, which was the Date field. Visual Compiler 2
starts from the exact element the human used. A locator candidate must resolve
back to that demonstrated fingerprint and be compatible with the action.
Generic role-only textbox selection cannot compile.

Earlier runtime success could mean only that Playwright returned without an
exception. This allowed unchanged state or application error pages to look
successful. Visual Compiler 2 requires stable positive evidence and checks
negative evidence such as error markers, unexpected pages/popups, missing
popup closure, and unchanged required state.

Legacy CGI behavior also exposed the need to model anchors with `onclick`,
editor facades, hidden backing fields, iframes, transient validation popups, and
return-to-opener behavior as first-class workflow semantics.

Repeated Lab testing became cumbersome when every replay repeated compilation
or attestations. Authentication and teaching remain explicit, but a compiled
artifact supports immediate local execution and Run again without new model
calls or repetitive confirmation.

## Why demonstration-first

Instruction-first targeting guesses which live element matches prose.
Demonstration-first targeting observes the actual human choice and asks only how
that choice should generalize. This reverses the evidence hierarchy: language
may describe iteration and intent, but it cannot silently substitute a
different control. The result is more reliable on ambiguous forms and legacy
applications while retaining deterministic local replay.
