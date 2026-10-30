// Downstream (FL-Penly/ovis, DOWNSTREAM.md): attached files as marks where they were pasted.
import { describe, expect, test } from "bun:test";
import { caretOutsideTokens, expandTokens, insertTokens, nextTokenNumber, repairTokenEdit, tokenLabels, tokenLinks, tokenText, TokenStore, unplacedTokens, withoutToken, type TokenEntry } from "./attachmentTokens.ts";

const image = (n: number, path: string | null = `/repo/.ovis/paste-${n}.png`): TokenEntry => ({ token: `[图片${n}]`, path, name: `paste-${n}.png`, image: true });
const label = (n: string) => `图片${n}`;

describe("attachment marks", () => {
  test("number past every mark in the text and the entries", () => {
    expect(nextTokenNumber("", [], label)).toBe(1);
    expect(nextTokenNumber("看 [图片2] 和 [图片7]", [image(3)], label)).toBe(8);
    expect(nextTokenNumber("[文件9]", [], label)).toBe(1);
    expect(nextTokenNumber("[Image 4]", [], (n) => `Image ${n}`)).toBe(5);
  });

  test("go in at the caret, in place of a selection", () => {
    expect(insertTokens("你好，这里有问题", 2, 2, ["[图片1]"])).toEqual({ text: "你好[图片1]，这里有问题", caret: 7 });
    expect(insertTokens("abcdef", 1, 4, ["[图片1]", "[图片2]"])).toEqual({ text: "a[图片1] [图片2]ef", caret: 12 });
  });

  test("are deleted whole", () => {
    const tokens = ["[图片1]"];
    expect(repairTokenEdit("a[图片1]b", "a[图片1b", tokens)).toEqual({ text: "ab", caret: 1 });
    expect(repairTokenEdit("a[图片1]b", "a图片1]b", tokens)).toEqual({ text: "ab", caret: 1 });
    expect(repairTokenEdit("ab[图片1]c", "ax片1]c", tokens)).toEqual({ text: "axc", caret: 2 });
    expect(repairTokenEdit("a[图片1]b", "ab", tokens)).toBeNull();
    expect(repairTokenEdit("a[图片1]b", "a[图片1]bc", tokens)).toBeNull();
  });

  test("take text typed inside them after them", () => {
    expect(repairTokenEdit("a[图片1]b", "a[图x片1]b", ["[图片1]"])).toEqual({ text: "a[图片1]xb", caret: 7 });
  });

  test("keep the caret out of them", () => {
    expect(caretOutsideTokens("a[图片1]b", 3, ["[图片1]"])).toBe(1);
    expect(caretOutsideTokens("a[图片1]b", 5, ["[图片1]"])).toBe(6);
    expect(caretOutsideTokens("a[图片1]b", 6, ["[图片1]"])).toBe(6);
  });

  test("leave with their space", () => {
    expect(withoutToken("看 [图片1] 这里", "[图片1]")).toBe("看 这里");
    expect(withoutToken("[图片1] 这里", "[图片1]")).toBe("这里");
    expect(withoutToken("这里", "[图片1]")).toBeNull();
  });

  test("are sent with their paths where they stand", () => {
    const sent = expandTokens("登录页按钮错位了[图片1]，报错是这个[图片2]\n帮我修", [image(1), image(2)]);
    expect(sent).toBe("登录页按钮错位了[图片1] @/repo/.ovis/paste-1.png ，报错是这个[图片2] @/repo/.ovis/paste-2.png\n帮我修");
    expect(expandTokens("[图片1] [图片3]", [image(1, null)])).toBe("[图片1] [图片3]");
    expect(unplacedTokens("x [图片1]", [image(1, null), image(2, null)]).map((entry) => entry.token)).toEqual(["[图片1]"]);
  });

  test("come back as links and labels in the chat", () => {
    const sent = "错位了[图片1] @/repo/.ovis/a.png ，见 [notes] @relative/b.png";
    expect(tokenLinks(sent)).toBe("错位了[图片1](/repo/.ovis/a.png) ，见 [notes] @relative/b.png");
    expect([...tokenLabels(sent)]).toEqual([["/repo/.ovis/a.png", "图片1"]]);
    expect(tokenText(sent)).toBe("错位了[图片1] ，见 [notes] @relative/b.png");
  });

  test("are stored once they have a path", () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
    new TokenStore(() => storage).write("pane", [image(1), image(2, null)]);
    expect(new TokenStore(() => storage).read("pane")).toEqual([image(1)]);
    new TokenStore(() => storage).write("pane", [image(2, null)]);
    expect(saved.size).toBe(0);
  });
});
