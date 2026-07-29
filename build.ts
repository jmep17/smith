// Compile dist/smith. Ink's devtools.js imports the optional package
// react-devtools-core; stub it so the compiled binary doesn't try to
// resolve it at runtime.
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
