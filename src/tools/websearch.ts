import { parseHTML } from "linkedom";
import { z } from "zod";
import type { ToolDef } from "./types.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const schema = z.object({
  query: z.string().describe("Search query"),
});

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function braveSearch(query: string, apiKey: string): Promise<SearchHit[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
    {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error(`Brave search failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    web?: { results?: { title: string; url: string; description?: string }[] };
  };
  return (body.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
  }));
}

async function ddgSearch(query: string): Promise<SearchHit[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `q=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo search failed: HTTP ${res.status}`);
  const { document } = parseHTML(await res.text());
  const results: SearchHit[] = [];
  for (const el of document.querySelectorAll(".result")) {
    const link = el.querySelector("a.result__a");
    const snippet = el.querySelector(".result__snippet");
    const href = link?.getAttribute("href") ?? "";
    // DDG wraps URLs: //duckduckgo.com/l/?uddg=<encoded>
    const uddg = href.match(/uddg=([^&]+)/)?.[1];
    const url = uddg ? decodeURIComponent(uddg) : href;
    if (link?.textContent && url.startsWith("http")) {
      results.push({
        title: link.textContent.trim(),
        url,
        snippet: snippet?.textContent?.trim() ?? "",
      });
    }
    if (results.length >= 8) break;
  }
  return results;
}

export const webSearchTool: ToolDef<typeof schema> = {
  name: "WebSearch",
  description:
    "Search the web. Returns titles, URLs, and snippets. Follow up with WebFetch to read a result.",
  schema,
  readOnly: true,
  specifier: (input) => input.query,
  async execute(input) {
    const apiKey = process.env.BRAVE_API_KEY;
    const hits = apiKey
      ? await braveSearch(input.query, apiKey)
      : await ddgSearch(input.query);
    if (hits.length === 0) return "No results.";
    return hits
      .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
      .join("\n");
  },
};
