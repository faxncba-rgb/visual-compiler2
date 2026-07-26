import { describe, expect, it } from "vitest";
import {
  StudioStateMachine,
  canonicalizeUrl,
  isOpenAIUrl,
  redactObject,
} from "../../packages/shared/src";

describe("shared safety boundaries", () => {
  it("canonicalizes URLs without persisting query parameters or hashes", () => {
    expect(
      canonicalizeUrl(
        "http://127.0.0.1:4273/fixture?patient=synthetic#consultation",
      ),
    ).toEqual({
      origin: "http://127.0.0.1:4273",
      pathname: "/fixture",
      canonicalUrl: "http://127.0.0.1:4273/fixture",
    });
  });

  it("redacts secret-shaped keys and URL queries", () => {
    expect(
      redactObject({
        targetUrl: "http://localhost:4273/fixture?token=secret",
        password: "never",
      }),
    ).toEqual({
      targetUrl: "http://localhost:4273/fixture",
      password: "[REDACTED]",
    });
  });

  it("keeps safe Demonstration Session structure visible in Studio", () => {
    expect(
      redactObject({
        session: { id: "demo-safe", authenticationExcluded: true },
      }),
    ).toEqual({
      session: { id: "demo-safe", authenticationExcluded: true },
    });
  });

  it.each([
    "https://api.openai.com/v1/responses",
    "wss://api.openai.com/v1/realtime",
    "https://platform.openai.com/settings",
  ])("classifies OpenAI network targets: %s", (url) => {
    expect(isOpenAIUrl(url)).toBe(true);
  });
});

describe("Studio state machine", () => {
  it("enforces manual-auth and explicit teaching transitions", () => {
    const machine = new StudioStateMachine();
    machine.transition("BROWSER_OPEN");
    machine.transition("AUTHENTICATING");
    expect(() => machine.transition("RECORDING")).toThrow(
      "Invalid Studio transition",
    );
    machine.transition("READY_TO_TEACH");
    machine.transition("RECORDING");
    machine.transition("DEMONSTRATION_REVIEW");
    machine.transition("COMPILING");
    machine.compileReady();
    machine.transition("RUNNING");
    machine.transition("PASSED");
    machine.transition("RUNNING");
    expect(machine.state).toBe("RUNNING");
  });

  it("prevents duplicate compile and run transitions", () => {
    const machine = new StudioStateMachine();
    machine.transition("BROWSER_OPEN");
    machine.transition("READY_TO_TEACH");
    machine.transition("RECORDING");
    machine.transition("DEMONSTRATION_REVIEW");
    machine.transition("COMPILING");
    expect(() => machine.transition("COMPILING")).toThrow();
  });

  it("returns a rejected compilation to review for an immediate retry", () => {
    const machine = new StudioStateMachine();
    machine.transition("BROWSER_OPEN");
    machine.transition("READY_TO_TEACH");
    machine.transition("RECORDING");
    machine.transition("DEMONSTRATION_REVIEW");
    machine.transition("COMPILING");
    machine.transition("DEMONSTRATION_REVIEW");
    machine.transition("COMPILING");
    expect(machine.state).toBe("COMPILING");
  });
});
