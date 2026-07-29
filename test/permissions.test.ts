import { describe, expect, test } from "bun:test";
import { evaluatePermission, ruleForAlways } from "../src/permissions/engine.ts";
import { bashTool } from "../src/tools/bash.ts";
import { editTool } from "../src/tools/edit.ts";
import { readTool } from "../src/tools/read.ts";

const settings = (allow: string[] = [], deny: string[] = []) => ({ allow, deny });

describe("permission engine", () => {
  test("read-only tools auto-allow", () => {
    expect(evaluatePermission(readTool, "/etc/hosts", settings())).toBe("allow");
  });

  test("write tools default to ask", () => {
    expect(evaluatePermission(bashTool, "ls", settings())).toBe("ask");
    expect(evaluatePermission(editTool, "src/a.ts", settings())).toBe("ask");
  });

  test("bare tool-name rule allows everything for that tool", () => {
    expect(evaluatePermission(bashTool, "rm -rf /tmp/x", settings(["Bash"]))).toBe(
      "allow",
    );
  });

  test("Bash prefix rules", () => {
    const s = settings(["Bash(npm *)"]);
    expect(evaluatePermission(bashTool, "npm run build", s)).toBe("allow");
    expect(evaluatePermission(bashTool, "npx something", s)).toBe("ask");
    expect(evaluatePermission(bashTool, "rm -rf .", s)).toBe("ask");
  });

  test("path glob rules for Edit", () => {
    const s = settings(["Edit(src/**)"]);
    expect(evaluatePermission(editTool, "src/deep/file.ts", s)).toBe("allow");
    expect(evaluatePermission(editTool, "other/file.ts", s)).toBe("ask");
  });

  test("deny wins over allow", () => {
    const s = settings(["Bash"], ["Bash(rm *)"]);
    expect(evaluatePermission(bashTool, "ls", s)).toBe("allow");
    expect(evaluatePermission(bashTool, "rm -rf /", s)).toBe("deny");
  });

  test("deny beats read-only auto-allow", () => {
    expect(
      evaluatePermission(readTool, "secrets/key.pem", settings([], ["Read(secrets/**)"])),
    ).toBe("deny");
  });

  test("ruleForAlways generalizes Bash to the command head", () => {
    expect(ruleForAlways("Bash", "npm run test --watch")).toBe("Bash(npm *)");
    expect(ruleForAlways("Edit", "src/a.ts")).toBe("Edit");
  });
});
