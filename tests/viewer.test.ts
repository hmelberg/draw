import { describe, expect, test } from "vitest";
import { parseViewerHash } from "../src/viewer";
import { desmartenJson, extractJson } from "../src/spec/extract";

describe("parseViewerHash", () => {
  test("accepts #gdoc=<id> with defaults", () => {
    const r = parseViewerHash("#gdoc=1AbC_dEf-123456789");
    expect(r).toMatchObject({ docId: "1AbC_dEf-123456789", backend: "custom-svg", mode: "narrated" });
  });

  test("accepts #gdoc-<id> and extra params", () => {
    const r = parseViewerHash("#gdoc-1AbC_dEf-123456789&backend=clean-svg&mode=silent&speed=1.5");
    expect(r).toMatchObject({ docId: "1AbC_dEf-123456789", backend: "clean-svg", mode: "silent", speed: 1.5 });
  });

  test("returns null without a gdoc fragment", () => {
    expect(parseViewerHash("#something-else")).toBeNull();
    expect(parseViewerHash("")).toBeNull();
  });
});

describe("desmartenJson", () => {
  test("repairs word-processor quotes so the JSON parses", () => {
    const doc = "My spec:\n\n{“template”: “supply_demand”, “commands”: []}";
    const spec = extractJson(desmartenJson(doc)) as { template: string };
    expect(spec.template).toBe("supply_demand");
  });

  test("strips BOM and non-breaking spaces", () => {
    const doc = '﻿{"a": 1}';
    expect(extractJson(desmartenJson(doc))).toEqual({ a: 1 });
  });
});
