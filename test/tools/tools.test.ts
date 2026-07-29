import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfile } from "../../src/provider/profiles.ts";
import { bashTool } from "../../src/tools/bash.ts";
import { editTool } from "../../src/tools/edit.ts";
import { globTool } from "../../src/tools/glob.ts";
import { grepTool } from "../../src/tools/grep.ts";
import { readTool } from "../../src/tools/read.ts";
import type { ToolContext } from "../../src/tools/types.ts";
import { writeTool } from "../../src/tools/write.ts";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-test-"));
  ctx = {
    cwd: dir,
    readFiles: new Set(),
    profile: getProfile("air"),
    spillDir: dir,
    setCwd: (d) => {
      ctx.cwd = d;
    },
    todos: [],
  };
});

describe("Read", () => {
  test("numbers lines and records the read", async () => {
    await Bun.write(join(dir, "a.txt"), "alpha\nbeta\ngamma");
    const out = await readTool.execute({ file_path: "a.txt" }, ctx);
    expect(out).toContain("     1\talpha");
    expect(out).toContain("     3\tgamma");
    expect(ctx.readFiles.has(join(dir, "a.txt"))).toBe(true);
  });

  test("offset/limit and PARTIAL notice", async () => {
    await Bun.write(
      join(dir, "b.txt"),
      Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join("\n"),
    );
    const out = await readTool.execute({ file_path: "b.txt", offset: 3, limit: 2 }, ctx);
    expect(out).toContain("     3\tL3");
    expect(out).toContain("     4\tL4");
    expect(out).not.toContain("L5");
    expect(out).toContain("PARTIAL");
  });

  test("errors on missing file and on directories", async () => {
    expect(readTool.execute({ file_path: "nope.txt" }, ctx)).rejects.toThrow("not found");
    expect(readTool.execute({ file_path: dir }, ctx)).rejects.toThrow("directory");
  });
});

describe("Write", () => {
  test("creates a new file (with parent dirs)", async () => {
    const out = await writeTool.execute(
      { file_path: "sub/new.txt", content: "hi\n" },
      ctx,
    );
    expect(out).toContain("Created");
    expect(await Bun.file(join(dir, "sub/new.txt")).text()).toBe("hi\n");
  });

  test("refuses to overwrite an unread file", async () => {
    await Bun.write(join(dir, "x.txt"), "old");
    expect(
      writeTool.execute({ file_path: "x.txt", content: "new" }, ctx),
    ).rejects.toThrow("Read it first");
  });
});

describe("Edit", () => {
  const setup = async (content: string) => {
    const p = join(dir, "e.txt");
    await Bun.write(p, content);
    ctx.readFiles.add(p);
    return p;
  };

  test("replaces a unique match", async () => {
    const p = await setup("one two three");
    await editTool.execute(
      { file_path: "e.txt", old_string: "two", new_string: "2" },
      ctx,
    );
    expect(await Bun.file(p).text()).toBe("one 2 three");
  });

  test("enforces read-before-edit", async () => {
    await Bun.write(join(dir, "u.txt"), "text");
    expect(
      editTool.execute({ file_path: "u.txt", old_string: "text", new_string: "x" }, ctx),
    ).rejects.toThrow("before editing");
  });

  test("rejects non-unique matches unless replace_all", async () => {
    const p = await setup("dup dup");
    expect(
      editTool.execute({ file_path: "e.txt", old_string: "dup", new_string: "x" }, ctx),
    ).rejects.toThrow("must be unique");
    await editTool.execute(
      { file_path: "e.txt", old_string: "dup", new_string: "x", replace_all: true },
      ctx,
    );
    expect(await Bun.file(p).text()).toBe("x x");
  });

  test("rejects missing old_string", async () => {
    await setup("content");
    expect(
      editTool.execute(
        { file_path: "e.txt", old_string: "absent", new_string: "x" },
        ctx,
      ),
    ).rejects.toThrow("not found");
  });
});

describe("Bash", () => {
  test("runs a command and reports exit code", async () => {
    const out = await bashTool.execute({ command: "echo hello; exit 3" }, ctx);
    expect(out).toContain("hello");
    expect(out).toContain("[exit code 3]");
  });

  test("persists cd across calls", async () => {
    await bashTool.execute({ command: "mkdir -p inner && cd inner" }, ctx);
    const { realpathSync } = await import("node:fs");
    expect(ctx.cwd).toBe(realpathSync(join(dir, "inner")));
  });

  test("caps output and spills to file", async () => {
    const out = await bashTool.execute({ command: "yes A | head -c 40000" }, ctx);
    expect(out).toContain("[output truncated at 30000 chars");
    expect(out.length).toBeLessThan(31000);
  });

  test("times out", async () => {
    const out = await bashTool.execute({ command: "sleep 5", timeout: 300 }, ctx);
    expect(out).toContain("timed out");
  }, 10000);
});

describe("Glob", () => {
  test("finds files, newest first, no node_modules", async () => {
    await Bun.write(join(dir, "old.ts"), "1");
    await Bun.write(join(dir, "node_modules/x.ts"), "1");
    await new Promise((r) => setTimeout(r, 20));
    await Bun.write(join(dir, "new.ts"), "1");
    const out = await globTool.execute({ pattern: "**/*.ts" }, ctx);
    const lines = out.split("\n");
    expect(lines[0]).toContain("new.ts");
    expect(lines[1]).toContain("old.ts");
    expect(out).not.toContain("node_modules");
  });

  test("reports no matches", async () => {
    expect(await globTool.execute({ pattern: "*.zig" }, ctx)).toBe("No files matched.");
  });
});

describe("Grep", () => {
  test("files_with_matches then content mode", async () => {
    await Bun.write(join(dir, "s.ts"), "const needle = 1;\nother line");
    const files = await grepTool.execute({ pattern: "needle" }, ctx);
    expect(files).toContain("s.ts");
    const content = await grepTool.execute(
      { pattern: "needle", output_mode: "content" },
      ctx,
    );
    expect(content).toContain("1:const needle = 1;");
  });

  test("no matches", async () => {
    await Bun.write(join(dir, "s.ts"), "nothing here");
    expect(await grepTool.execute({ pattern: "zzz_absent" }, ctx)).toBe("No matches.");
  });
});
