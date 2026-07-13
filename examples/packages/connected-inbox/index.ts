import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const fetchJson = defineTool({
  name: "connected_inbox_fetch_json",
  label: "Fetch connected inbox data",
  description: "Fetch JSON from an HTTPS endpoint for the connected-inbox example.",
  parameters: Type.Object({
    url: Type.String({ description: "HTTPS endpoint to fetch" }),
  }),
  async execute(_toolCallId, { url }, signal) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:") throw new Error("Connected inbox only accepts HTTPS endpoints.");
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`Connected inbox request failed with ${response.status}.`);
    const text = await response.text();
    if (text.length > 128_000) throw new Error("Connected inbox response exceeded 128 KB.");
    const data = JSON.parse(text) as unknown;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      details: { url: endpoint.toString(), status: response.status },
    };
  },
});

export default function connectedInbox(pi: ExtensionAPI) {
  pi.registerTool(fetchJson);
}
