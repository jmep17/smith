// Compile dist/smith. Ink's devtools.js imports the optional package
// react-devtools-core; stub it so the compiled binary doesn't try to
// resolve it at runtime.
// With --install (`bun run install-bin`), the binary is then copied to
// SMITH_INSTALL_DIR or ~/.local/bin.
import { chmod, copyFile, mkdir } from "node:fs/promises";

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  compile: { outfile: "dist/smith" },
  plugins: [
    {
      name: "stub-react-devtools",
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: "react-devtools-core-stub",
          namespace: "stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("built dist/smith");

if (Bun.argv.includes("--install")) {
  const dir = process.env.SMITH_INSTALL_DIR ?? `${process.env.HOME}/.local/bin`;
  await mkdir(dir, { recursive: true });
  const dest = `${dir}/smith`;
  await copyFile("dist/smith", dest);
  await chmod(dest, 0o755);
  console.log(`installed ${dest}`);
  const onPath = (process.env.PATH ?? "").split(":").includes(dir);
  if (!onPath) {
    console.log(`note: ${dir} is not on your PATH — add this to your shell rc:`);
    console.log(`  export PATH="${dir}:$PATH"`);
  }
}
