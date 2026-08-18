import { describe, expect, test } from "vitest";
import { compileExpression } from "../src/spec/expression";

describe("compileExpression", () => {
  test("evaluates a linear demand function", () => {
    const f = compileExpression("100 - 0.5*x", ["x"]);
    expect(f({ x: 100 })).toBe(50);
    expect(f({ x: 0 })).toBe(100);
  });

  test("respects operator precedence", () => {
    const f = compileExpression("2 + 3 * 4", []);
    expect(f({})).toBe(14);
  });

  test("exponentiation is right-associative", () => {
    const f = compileExpression("2^3^2", []);
    expect(f({})).toBe(512);
  });

  test("unary minus binds looser than exponentiation", () => {
    const f = compileExpression("-x^2", ["x"]);
    expect(f({ x: 3 })).toBe(-9);
  });

  test("supports functions and constants", () => {
    expect(compileExpression("max(1, min(2, 3))", [])({})).toBe(2);
    expect(compileExpression("exp(0) + sqrt(9)", [])({})).toBe(4);
    expect(compileExpression("ln(e)", [])({})).toBeCloseTo(1);
  });

  test("rejects unknown identifiers", () => {
    expect(() => compileExpression("y + 1", ["x"])).toThrow();
    expect(() => compileExpression("evil(3)", ["x"])).toThrow();
  });

  test("rejects malformed input", () => {
    expect(() => compileExpression("1 +", [])).toThrow();
    expect(() => compileExpression("(1", [])).toThrow();
    expect(() => compileExpression("", [])).toThrow();
  });

  test("division by zero yields non-finite, not a throw", () => {
    const f = compileExpression("1/x", ["x"]);
    expect(Number.isFinite(f({ x: 0 }))).toBe(false);
  });
});
