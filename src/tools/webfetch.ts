import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { z } from "zod";
import type { ToolDef } from "./types.ts";

const FETCH_TIMEOUT_MS = 15_000;
const UA = "smith-agent/0.1 (local coding agent)";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndown.remove(["script", "style", "nav", "footer", "iframe"]);

const schema = z.object({
  url: z.string().describe("Full URL to fetch (http/https)"),
});

export const webFetchTool: ToolDef<typeof schema> = {
  name: "WebFetch",
  description:
    "Fetch a web page (e.g. library documentation) and return its main content as markdown.",
  schema,
  readOnly: false,
  specifier: (input) => input.url,
  async execute(input) {
    const url = new URL(
      input.url.startsWith("http") ? input.url : `https://${input.url}`,
    );
    if (url.protocol === "http:") url.protocol = "https:";
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": UA, Accept: "text/html,text/*;q=0.9,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} for ${url}`);
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();

    if (!contentType.includes("html")) {
      return body;
    }
    const { document } = parseHTML(body);
    const article = new Readability(document as unknown as Document, {
      charThreshold: 100,
    }).parse();
    const html = article?.content ?? body;
    const markdown = turndown.turndown(html).trim();
    const title = article?.title ? `# ${article.title}\n\n` : "";
    return `${title}${markdown || "[no extractable content]"}`;
  },
};
