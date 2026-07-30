import { beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectDevServer,
  isCheckableFile,
  runPostEditChecks,
  typecheckCommand,
} from "../src/agent/diagnostics.ts";
import { detectStack } from "../src/agent/stack.ts";
import { getProfile } from "../src/provider/profiles.ts";
import type { ToolContext } from "../src/tools/types.ts";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-diag-"));
  ctx = {
    cwd: dir,
    readFiles: new Set(),
    profile: getProfile("m4"),
    spillDir: dir,
    setCwd: (d) => {
      ctx.cwd = d;
    },
    todos: [],
    lastDiagnosticsAt: 0,
  };
});

async function writePkg(pkg: object) {
  await Bun.write(join(dir, "package.json"), JSON.stringify(pkg));
}

/** Stub node_modules/.bin/tsc that prints `output` and exits with `code`. */
async function stubTsc(code: number, output = "") {
  const bin = join(dir, "node_modules/.bin");
  await mkdir(bin, { recursive: true });
  const path = join(bin, "tsc");
  await Bun.write(
    path,
    `#!/bin/sh\n${output ? `echo "${output}"` : ":"}\nexit ${code}\n`,
  );
  await chmod(path, 0o755);
}

describe("isCheckableFile", () => {
  test("code files yes, styles and docs no", () => {
    expect(isCheckableFile("/a/b/Button.tsx")).toBe(true);
    expect(isCheckableFile("store.ts")).toBe(true);
    expect(isCheckableFile("App.vue")).toBe(true);
    expect(isCheckableFile("globals.css")).toBe(false);
    expect(isCheckableFile("README.md")).toBe(false);
  });
});

describe("typecheckCommand", () => {
  test("uses a tsc-only script via the package manager", async () => {
    await writePkg({
      devDependencies: { typescript: "^5.0.0" },
      scripts: { typecheck: "tsc --noEmit" },
    });
    await Bun.write(join(dir, "bun.lock"), "");
    const stack = (await detectStack(dir))!;
    expect(await typecheckCommand(stack, dir)).toEqual(["bun", "run", "typecheck"]);
  });

  test("refuses non-tsc scripts and falls back to the local binary", async () => {
    await writePkg({ scripts: { typecheck: "echo pwned && tsc" } });
    const stack = (await detectStack(dir))!;
    // No local tsc installed: nothing safe to run.
    expect(await typecheckCommand(stack, dir)).toBeNull();
    await stubTsc(0);
    expect(await typecheckCommand(stack, dir)).toEqual([
      join(dir, "node_modules/.bin/tsc"),
      "--noEmit",
    ]);
  });
});

describe("runPostEditChecks", () => {
  test("reports typecheck errors from a failing tsc", async () => {
    await writePkg({ dependencies: { react: "^19.0.0" } });
    await stubTsc(1, "a.ts(1,1): error TS2322: bad");
    const out = await runPostEditChecks(join(dir, "a.ts"), ctx);
    expect(out).toContain("TYPECHECK ERRORS");
    expect(out).toContain("TS2322");
  });

  test("reports success and debounces the next call", async () => {
    await writePkg({ dependencies: { react: "^19.0.0" } });
    await stubTsc(0);
    await Bun.write(join(dir, "a.ts"), "export {}");
    expect(await runPostEditChecks(join(dir, "a.ts"), ctx)).toBe("✓ typecheck passed");
    expect(await runPostEditChecks(join(dir, "a.ts"), ctx)).toBeNull();
  });

  test("skips non-code files and disabled profiles", async () => {
    await writePkg({ dependencies: { react: "^19.0.0" } });
    await stubTsc(1, "error");
    expect(await runPostEditChecks(join(dir, "style.css"), ctx)).toBeNull();
    ctx.profile = { ...getProfile("m4"), postEditChecks: false };
    expect(await runPostEditChecks(join(dir, "a.ts"), ctx)).toBeNull();
  });

  test("flags Tailwind arbitrary values, passes token classes", async () => {
    await writePkg({ dependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" } });
    await Bun.write(
      join(dir, "Card.tsx"),
      `export const C = () => <div className="bg-[#6C5CE7] px-[13px] text-brand" />;`,
    );
    const out = await runPostEditChecks(join(dir, "Card.tsx"), ctx);
    expect(out).toContain("DESIGN TOKENS");
    expect(out).toContain("[#6C5CE7]");
    expect(out).toContain("[13px]");

    ctx.lastDiagnosticsAt = 0;
    await Bun.write(
      join(dir, "Ok.tsx"),
      `export const O = () => <div className="bg-brand" />;`,
    );
    expect(await runPostEditChecks(join(dir, "Ok.tsx"), ctx)).toBeNull();
  });
});

describe("detectDevServer", () => {
  test("finds a live server, null otherwise", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const port = server.port as number;
    expect(await detectDevServer([port])).toBe(port);
    server.stop(true);
    await Bun.sleep(50);
    expect(await detectDevServer([port])).toBeNull();
  });
});
