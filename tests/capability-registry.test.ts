import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import {
  RemoteCapabilityRegistry,
  type CapabilityRegistryItem,
} from "../src/local/agent/capability-registry.js";

const commitSha = "1111111111111111111111111111111111111111";
const treeSha = "2222222222222222222222222222222222222222";
const commitPayload = {
  sha: commitSha,
  commit: { tree: { sha: treeSha } },
};
const treePayload = {
  sha: treeSha,
  truncated: false,
  tree: [
    { path: "brave-search", mode: "040000", type: "tree" },
    { path: "brave-search/SKILL.md", mode: "100644", type: "blob", size: 120 },
    { path: "brave-search/scripts/search.js", mode: "100644", type: "blob", size: 24 },
    { path: "brave-search/references/usage.md", mode: "100644", type: "blob", size: 12 },
    { path: "other-skill/SKILL.md", mode: "100644", type: "blob", size: 100 },
  ],
};

const skillFiles: Record<string, string> = {
  "brave-search/SKILL.md": "---\nname: brave-search\ndescription: Search the web with Brave. Use for current web research.\nlicense: MIT\n---\n# Brave Search\n",
  "brave-search/scripts/search.js": "console.log('search');\n",
  "brave-search/references/usage.md": "# Usage\n",
  "other-skill/SKILL.md": "---\nname: other-skill\ndescription: Another official Skill.\n---\n# Other\n",
};

test("remote capability search merges first-party Skills, references, and bounded npm results", async () => {
  const calls = new Map<string, number>();
  const fetch = mockFetch((url) => {
    count(calls, url.pathname);
    if (url.pathname === "/repos/badlogic/pi-skills/commits/main") return jsonResponse(commitPayload);
    if (url.pathname === `/repos/badlogic/pi-skills/git/trees/${treeSha}`) return jsonResponse(treePayload);
    if (url.host === "raw.githubusercontent.com") return textResponse(skillFiles[decodeRawPath(url)] ?? "", 200);
    if (url.pathname === "/-/v1/search") {
      assert.match(url.searchParams.get("text") ?? "", /^keywords:pi-package/);
      assert.equal(url.searchParams.get("size"), "250");
      return jsonResponse({
        total: 2,
        objects: [
          {
            package: {
              name: "community-extension",
              description: "A Pi extension for useful automation.",
              version: "2.0.0",
              date: "2026-07-10T12:00:00.000Z",
              keywords: ["pi-package", "pi-extension"],
              publisher: { username: "builder" },
              links: {
                npm: "https://www.npmjs.com/package/community-extension",
                repository: "git+https://github.com/example/community-extension.git",
              },
            },
            downloads: { monthly: 900 },
          },
          {
            package: {
              name: "community-skill",
              description: "A reusable Agent Skill.",
              version: "1.2.3",
              date: "2026-07-09T12:00:00.000Z",
              keywords: ["pi-package", "agent-skill"],
              publisher: { username: "teacher" },
              links: { npm: "https://www.npmjs.com/package/community-skill" },
            },
            downloads: { monthly: 1_200 },
          },
        ],
      });
    }
    return textResponse("not found", 404);
  });
  const registry = new RemoteCapabilityRegistry({ fetch, cacheTtlMs: 60_000 });

  const first = await registry.search({ type: "all", sort: "official", offset: 0, limit: 20 });
  assert.equal(first.diagnostics.length, 0);
  assert.equal(first.items.some((item) => item.id === "official:earendil-works/pi-review"), true);
  assert.equal(first.items.some((item) => item.name === "brave-search" && item.sourceKind === "bundle"), true);
  assert.equal(first.items.some((item) => item.id === "npm:community-extension"), true);
  assert.equal(first.items.find((item) => item.id === "npm:community-extension")?.installSource, "npm:community-extension@2.0.0");
  const firstCommunityIndex = first.items.findIndex((item) => !item.official);
  assert.equal(first.items.slice(0, firstCommunityIndex).every((item) => item.official), true);

  const extensions = await registry.search({ type: "extension", sort: "downloads", offset: 0, limit: 20 });
  assert.equal(extensions.items.every((item) => item.types.includes("extension")), true);
  assert.equal(extensions.items[0].id, "npm:community-extension");
  assert.equal(calls.get("/-/v1/search"), 1, "the npm result should be cached");
  assert.equal(calls.get("/repos/badlogic/pi-skills/commits/main"), 1, "the Git commit should be cached");
  assert.equal(calls.get(`/repos/badlogic/pi-skills/git/trees/${treeSha}`), 1, "the immutable Git tree should be cached");
  assert.equal(calls.get(`/badlogic/pi-skills/${commitSha}/brave-search/SKILL.md`), 1);
});

test("npm discovery retries a throttled query and caches one bounded result window", async () => {
  const offsets: number[] = [];
  const texts: string[] = [];
  let throttled = false;
  const fetch = mockFetch((url) => {
    if (url.pathname === "/-/v1/search") {
      const offset = Number(url.searchParams.get("from"));
      offsets.push(offset);
      texts.push(url.searchParams.get("text") ?? "");
      assert.equal(offset, 0, "a cold query must not crawl later npm pages");
      if (!throttled) {
        throttled = true;
        return textResponse("rate limited", 429);
      }
      return jsonResponse({
        total: 251,
        objects: Array.from({ length: 250 }, (_, index) => npmSearchObject(
          `paged-extension-${String(index).padStart(3, "0")}`,
          index,
        )),
      });
    }
    return textResponse("not found", 404);
  });
  const registry = new RemoteCapabilityRegistry({ fetch });

  const mostDownloaded = await registry.search({ query: "paged", type: "extension", sort: "downloads", limit: 1 });
  assert.equal(mostDownloaded.items[0]?.id, "npm:paged-extension-249");
  assert.equal(mostDownloaded.total, 250);
  assert.equal(mostDownloaded.truncated, true);

  const lastByName = await registry.search({ query: "paged", type: "extension", sort: "name", offset: 249, limit: 1 });
  assert.equal(lastByName.items[0]?.id, "npm:paged-extension-249");
  assert.deepEqual(offsets, [0, 0], "the second call should reuse the successful bounded query window");
  assert.deepEqual(texts, ["keywords:pi-package paged", "keywords:pi-package paged"]);
});

test("npm details expose package resources, lifecycle scripts, and runtime dependency count", async () => {
  let manifestRequests = 0;
  const fetch = mockFetch((url) => {
    if (url.host === "registry.npmjs.org" && url.pathname.endsWith("/latest")) {
      manifestRequests += 1;
      return jsonResponse({
        name: "@demo/mixed-capability",
        version: "3.4.5",
        description: "A mixed Pi package.",
        author: { name: "Demo Author" },
        license: "Apache-2.0",
        homepage: "https://example.com/mixed",
        repository: { url: "git+https://github.com/demo/mixed-capability.git" },
        keywords: ["pi-package"],
        pi: {
          skills: ["skills/review"],
          extensions: ["extensions/index.ts"],
          prompts: ["prompts/review.md"],
          themes: ["themes/demo.json"],
        },
        scripts: {
          preinstall: "node verify.js",
          postinstall: "node setup.js",
          test: "node --test",
        },
        dependencies: { alpha: "1.0.0", shared: "1.0.0" },
        optionalDependencies: { beta: "2.0.0", shared: "2.0.0" },
      });
    }
    return textResponse("not found", 404);
  });
  const registry = new RemoteCapabilityRegistry({ fetch });

  const details = await registry.details("npm:@demo/mixed-capability");
  assert.deepEqual(details.types, ["skill", "extension"]);
  assert.deepEqual(details.skills, ["skills/review"]);
  assert.deepEqual(details.extensions, ["extensions/index.ts"]);
  assert.deepEqual(details.prompts, ["prompts/review.md"]);
  assert.deepEqual(details.themes, ["themes/demo.json"]);
  assert.deepEqual(details.installScripts, [
    { name: "preinstall", command: "node verify.js" },
    { name: "postinstall", command: "node setup.js" },
  ]);
  assert.equal(details.dependencyCount, 3);
  assert.equal(details.installSource, "npm:@demo/mixed-capability@3.4.5");
  assert.equal(details.repositoryUrl, "https://github.com/demo/mixed-capability");
  assert.equal(details.npmUrl, "https://www.npmjs.com/package/%40demo%2Fmixed-capability");
  assert.equal((await registry.details("npm:@demo/mixed-capability")).version, "3.4.5");
  assert.equal(manifestRequests, 1, "latest manifest details should be cached");
});

test("official Pi Skill bundles include the complete selected Skill and nothing from siblings", async () => {
  const rawPaths: string[] = [];
  const fetch = mockFetch((url) => {
    if (url.pathname === "/repos/badlogic/pi-skills/commits/main") return jsonResponse(commitPayload);
    if (url.pathname === `/repos/badlogic/pi-skills/git/trees/${treeSha}`) return jsonResponse(treePayload);
    if (url.host === "raw.githubusercontent.com") {
      rawPaths.push(url.pathname);
      const path = decodeRawPath(url);
      const body = skillFiles[path];
      return body === undefined ? textResponse("not found", 404) : textResponse(body);
    }
    return textResponse("not found", 404);
  });
  const registry = new RemoteCapabilityRegistry({ fetch });
  const catalog = await registry.search({ query: "brave-search", type: "skill", sort: "name" });
  const item = catalog.items.find((candidate) => candidate.name === "brave-search") as CapabilityRegistryItem | undefined;
  assert.ok(item);

  const bundle = await registry.buildOfficialSkillBundle(item.id);
  assert.equal(bundle.fileName, "brave-search.skill");
  const archive = await JSZip.loadAsync(bundle.bytes);
  assert.ok(archive.file("brave-search/SKILL.md"));
  assert.equal(await archive.file("brave-search/scripts/search.js")?.async("text"), "console.log('search');\n");
  assert.equal(await archive.file("brave-search/references/usage.md")?.async("text"), "# Usage\n");
  assert.equal(archive.file("other-skill/SKILL.md"), null);
  assert.ok(rawPaths.length > 0);
  assert.equal(rawPaths.every((path) => path.startsWith(`/badlogic/pi-skills/${commitSha}/`)), true);
  assert.equal(rawPaths.some((path) => path.includes("/main/")), false);
  assert.equal(item.version, commitSha.slice(0, 12));
  assert.match(item.repositoryUrl ?? "", new RegExp(`/tree/${commitSha}/`));
  const details = await registry.details(item.id);
  assert.deepEqual(details.skills, ["brave-search"]);
  assert.equal(details.dependencyCount, undefined, "uninspected bundled package metadata must remain unknown");
  assert.equal(details.installScripts, undefined, "uninspected bundled lifecycle scripts must remain unknown");
});

test("remote response limits are enforced before manifest data is trusted", async () => {
  const fetch = mockFetch((url) => {
    if (url.host === "registry.npmjs.org") return textResponse("x".repeat(2_000));
    return textResponse("not found", 404);
  });
  const registry = new RemoteCapabilityRegistry({ fetch, maxResponseBytes: 1_024 });
  await assert.rejects(registry.details("npm:oversized-package"), /exceeds the 1024-byte limit/);
  await assert.rejects(registry.details("npm:https://example.com/evil"), /Invalid npm capability id/);
});

function mockFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init)) as typeof globalThis.fetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return textResponse(JSON.stringify(value), status, "application/json");
}

function textResponse(value: string, status = 200, contentType = "text/plain"): Response {
  return new Response(value, {
    status,
    headers: {
      "content-type": contentType,
      "content-length": String(new TextEncoder().encode(value).byteLength),
    },
  });
}

function decodeRawPath(url: URL): string {
  const prefix = `/badlogic/pi-skills/${commitSha}/`;
  return url.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
}

function npmSearchObject(name: string, monthlyDownloads: number): Record<string, unknown> {
  return {
    package: {
      name,
      description: "A paged Pi extension.",
      version: "1.0.0",
      date: "2026-07-10T12:00:00.000Z",
      keywords: ["pi-package", "pi-extension"],
      publisher: { username: "builder" },
      links: { npm: `https://www.npmjs.com/package/${name}` },
    },
    downloads: { monthly: monthlyDownloads },
  };
}

function count(values: Map<string, number>, key: string): void {
  values.set(key, (values.get(key) ?? 0) + 1);
}
