import { describe, expect, it } from "vitest";
import { executeBoundedLoop } from "../../packages/deterministic-runtime/src";
import { loop } from "../helpers/factories";

describe("bounded deterministic iterations", () => {
  it("terminates when there is no next eligible item", async () => {
    const rows = ["a", "b", "c"];
    const seen: string[] = [];
    const result = await executeBoundedLoop(loop(), {
      async first() {
        return rows[0];
      },
      async next(current) {
        return rows[rows.indexOf(current) + 1];
      },
      async fingerprint(item) {
        return item;
      },
      async eligible() {
        return true;
      },
      async run(item) {
        seen.push(item);
      },
    });
    expect(seen).toEqual(rows);
    expect(result.iterations).toBe(3);
  });

  it("stops before executing a duplicate row fingerprint", async () => {
    const rows = ["a", "b", "a"];
    let cursor = 0;
    const seen: string[] = [];
    const result = await executeBoundedLoop(loop(), {
      async first() {
        return rows[0];
      },
      async next() {
        cursor += 1;
        return rows[cursor];
      },
      async fingerprint(item) {
        return item;
      },
      async eligible() {
        return true;
      },
      async run(item) {
        seen.push(item);
      },
    });
    expect(seen).toEqual(["a", "b"]);
    expect(result.iterations).toBe(2);
  });

  it("enforces maximum iterations", async () => {
    let value = 0;
    const result = await executeBoundedLoop(loop({ maximumIterations: 2 }), {
      async first() {
        return value;
      },
      async next() {
        value += 1;
        return value;
      },
      async fingerprint(item) {
        return String(item);
      },
      async eligible() {
        return true;
      },
      async run() {},
    });
    expect(result.iterations).toBe(2);
  });

  it("supports user Stop", async () => {
    const controller = new AbortController();
    await expect(
      executeBoundedLoop(
        loop(),
        {
          async first() {
            controller.abort();
            return "a";
          },
          async next() {
            return undefined;
          },
          async fingerprint(item) {
            return item;
          },
          async eligible() {
            return true;
          },
          async run() {},
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
