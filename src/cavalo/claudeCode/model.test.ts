import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { shapePrompt } from "./model";

type Prompt = LanguageModelV3CallOptions["prompt"];

const conversation: Prompt = [
  { role: "system", content: "Micah instructions" },
  { role: "user", content: [{ type: "text", text: "first question" }] },
  { role: "assistant", content: [{ type: "text", text: "an answer" }] },
  { role: "user", content: [{ type: "text", text: "second question" }] },
];

describe("shapePrompt", () => {
  it("sends only the new turn once a session exists", () => {
    const shaped = shapePrompt(conversation, true);
    expect(shaped?.prompt).toBe("second question");
    expect(shaped?.system).toBeNull();
  });

  it("replays the transcript when there is no session to resume", () => {
    const shaped = shapePrompt(conversation, false);
    expect(shaped?.prompt).toContain("first question");
    expect(shaped?.prompt).toContain("[assistant]\nan answer");
    expect(shaped?.prompt).toContain("second question");
    expect(shaped?.system).toBe("Micah instructions");
  });

  it("keys the conversation off the first turn, which never changes", () => {
    const withSession = shapePrompt(conversation, true);
    const grown: Prompt = [
      ...conversation,
      { role: "assistant", content: [{ type: "text", text: "another" }] },
      { role: "user", content: [{ type: "text", text: "third question" }] },
    ];
    expect(shapePrompt(grown, true)?.key).toBe(withSession?.key);
  });

  it("returns null when there is nothing from the user", () => {
    expect(shapePrompt([{ role: "system", content: "x" }], false)).toBeNull();
  });
});
