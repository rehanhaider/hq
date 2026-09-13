import { describe, expect, it } from "vitest";
import { declaredUploadBytes } from "./uploads";

describe("declaredUploadBytes", () => {
  it("accepts a positive whole number of bytes", () => {
    expect(declaredUploadBytes("1024")).toBe(1024);
    expect(declaredUploadBytes(" 26 ")).toBe(26);
  });

  it("refuses a missing, zero, or unusable length so the body is not read", () => {
    expect(declaredUploadBytes(null)).toBeNull();
    expect(declaredUploadBytes("")).toBeNull();
    expect(declaredUploadBytes("0")).toBeNull();
    expect(declaredUploadBytes("-1")).toBeNull();
    expect(declaredUploadBytes("1.5")).toBeNull();
    expect(declaredUploadBytes("1e7")).toBeNull();
    expect(declaredUploadBytes("abc")).toBeNull();
  });
});
