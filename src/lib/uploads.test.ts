import { describe, expect, it } from "vitest";
import {
  createUploadGate,
  declaredUploadBytes,
  uploadExtension,
  uploadIdFromUrl,
  uploadIdsInDocument,
  uploadRejection,
} from "./uploads";

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

describe("uploadIdsInDocument", () => {
  const id = `${"a".repeat(64)}.png`;

  it("collects HQ upload URLs and ignores external links", () => {
    expect(uploadIdFromUrl(`/api/uploads/${id}`)).toBe(id);
    expect(uploadIdFromUrl(`https://hq.local/api/uploads/${id}`)).toBe(id);
    expect(uploadIdFromUrl("https://example.com/plan.pdf")).toBeNull();
    expect(
      uploadIdsInDocument([
        { type: "image", props: { url: `/api/uploads/${id}` }, children: [] },
        { type: "file", props: { url: "https://example.com/plan.pdf" }, children: [] },
      ]),
    ).toEqual([id]);
  });
});

describe("zip MIME types", () => {
  it("accepts the types Windows Chrome and Edge send for a .zip", () => {
    for (const mime of [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-zip",
    ]) {
      expect(uploadRejection({ name: "bundle.zip", mime, size: 12 })).toBeNull();
      expect(uploadExtension("bundle", mime)).toBe("zip");
    }
  });
});

describe("createUploadGate", () => {
  it("lets a waiter proceed only after every start has an end", async () => {
    const gate = createUploadGate();
    expect(gate.busy).toBe(false);
    await gate.idle();
    gate.start();
    gate.start();
    expect(gate.busy).toBe(true);
    let released = false;
    const waiting = gate.idle().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    gate.end();
    await Promise.resolve();
    expect(released).toBe(false);
    gate.end();
    await waiting;
    expect(gate.busy).toBe(false);
  });
});
