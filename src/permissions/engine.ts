// Deny-first permission evaluation over rules shaped like Claude Code's:
//   "Bash"            — any Bash command
//   "Bash(npm *)"     — commands matching the prefix pattern
//   "Edit(src/**)"    — paths matching the glob
// deny > allow > readOnly auto-allow > ask.

import type { ToolDef } from "../tools/types.ts";
import type { PermissionSettings } from "./store.ts";

export type Decision = "allow" | "deny" | "ask";

interface ParsedRule {
  tool: string;
  spec: string | null;
}

function parseRule(rule: string): ParsedRule | null {
  const match = rule.match(/^([A-Za-z]+)(?:\((.*)\))?$/);
  if (!match) return null;
  return { tool: match[1]!, spec: match[2] ?? null };
}

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

function specMatches(spec: string, specifier: string, toolName: string): boolean {
  if (spec === "*") return true;
  if (toolName === "WebFetch") {
    // Rules are domain-scoped: "WebFetch(domain:example.com)" or bare host.
    const host = hostOf(specifier);
    const ruleHost = spec.replace(/^domain:/, "");
    return host === ruleHost || host.endsWith(`.${ruleHost}`);
  }
  if (toolName === "Bash") {
    // Prefix-style matching: "npm *" matches "npm run build".
    if (spec.endsWith("*")) {
      return (
        specifier.startsWith(`${spec.slice(0, -1).trimEnd()} `) ||
        specifier === spec.slice(0, -1).trimEnd() ||
        specifier.startsWith(spec.slice(0, -1))
      );
    }
    return specifier === spec;
  }
  // Path/glob matching for everything else.
  const glob = new Bun.Glob(spec);
  return glob.match(specifier) || glob.match(specifier.replace(/^\.\//, ""));
}

function ruleApplies(rule: string, toolName: string, specifier: string): boolean {
  const parsed = parseRule(rule);
  if (!parsed || parsed.tool !== toolName) return false;
  if (parsed.spec === null) return true;
  return specMatches(parsed.spec, specifier, toolName);
}

export function evaluatePermission(
  tool: ToolDef,
  specifier: string,
  settings: PermissionSettings,
): Decision {
  for (const rule of settings.deny) {
    if (ruleApplies(rule, tool.name, specifier)) return "deny";
  }
  for (const rule of settings.allow) {
    if (ruleApplies(rule, tool.name, specifier)) return "allow";
  }
  if (tool.readOnly) return "allow";
  return "ask";
}

/** The rule persisted when the user picks "always allow". */
export function ruleForAlways(toolName: string, specifier: string): string {
  if (toolName === "Bash") {
    // Allow the command's first word going forward, e.g. "Bash(npm *)".
    const head = specifier.trim().split(/\s+/)[0];
    return `Bash(${head} *)`;
  }
  if (toolName === "WebFetch") {
    return `WebFetch(domain:${hostOf(specifier)})`;
  }
  return toolName;
}
