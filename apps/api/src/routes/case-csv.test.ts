import { describe, expect, it } from "vitest";
import { parseCaseCsv } from "./case-csv.js";

describe("parseCaseCsv", () => {
  it("parses CRLF CSV with quoted commas, newlines and escaped quotes", () => {
    expect(parseCaseCsv([
      "id,sessionId,similarityGroup,content",
      'case-a,session-a,group-a,"Question, with comma"',
      'case-b,session-b,group-b,"Line one\nLine two and ""quote"""',
    ].join("\r\n"))).toEqual([
      { id: "case-a", sessionId: "session-a", similarityGroup: "group-a", content: "Question, with comma" },
      { id: "case-b", sessionId: "session-b", similarityGroup: "group-b", content: 'Line one\nLine two and "quote"' },
    ]);
  });

  it.each([
    ["missing required columns", "id,content\na,q"],
    ["unclosed quoted field", "id,sessionId,similarityGroup,content\na,b,c,\"open"],
    ["duplicate headers", "id,id,sessionId,similarityGroup,content\na,b,c,d,e"],
    ["empty record field", "id,sessionId,similarityGroup,content\na,b,,q"],
  ])("rejects %s", (_label, csv) => {
    expect(() => parseCaseCsv(csv)).toThrow("CASE_CSV_INVALID");
  });

  it("rejects CSV batches outside the supported row limit", () => {
    const header = "id,sessionId,similarityGroup,content";
    const rows = Array.from({ length: 41 }, (_, index) => `case-${index},s-${index},g-${index},Question ${index}`);
    expect(() => parseCaseCsv([header, ...rows].join("\n"))).toThrow("CASE_CSV_SIZE_INVALID");
  });
});