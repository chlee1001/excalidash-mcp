#!/usr/bin/env node
// End-to-end check against real ExcaliDash backend and frontend containers.
// Usage: npm run test:e2e   (EXCALIDASH_TAG selects the image, default 0.6.7)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const tag = process.env.EXCALIDASH_TAG ?? "0.6.7";
const prefix = `excalidash-mcp-e2e-${process.pid}`;
const network = prefix;
const backend = `${prefix}-backend`;
const frontend = `${prefix}-frontend`;
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const waitFor = async (url, what) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const ok = await fetch(url).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${what} did not become healthy`);
};

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// Same topology as upstream docker-compose: the frontend nginx serves the
// backend under /api/, which is the URL users give this MCP server.
const startExcaliDash = async () => {
  // The backend's CSRF check only trusts FRONTEND_URL, so the published port is fixed up front.
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  docker("network", "create", network);
  docker(
    "run", "-d", "--rm", "--name", backend, "--network", network, "--network-alias", "backend",
    "-e", "DATABASE_PROVIDER=sqlite", "-e", "DATABASE_URL=file:/app/prisma/dev.db",
    "-e", "PORT=8000", "-e", "NODE_ENV=production", "-e", "AUTH_MODE=local",
    "-e", "TRUST_PROXY=true", "-e", "ENFORCE_HTTPS_REDIRECT=false", "-e", `FRONTEND_URL=${origin}`,
    "-e", `JWT_SECRET=${randomBytes(32).toString("hex")}`,
    "-e", `CSRF_SECRET=${randomBytes(32).toString("hex")}`,
    `zimengxiong/excalidash-backend:${tag}`,
  );
  docker(
    "run", "-d", "--rm", "--name", frontend, "--network", network, "-p", `127.0.0.1:${port}:8080`,
    "-e", "BACKEND_URL=backend:8000",
    `zimengxiong/excalidash-frontend:${tag}`,
  );
  await waitFor(`${origin}/api/health`, `ExcaliDash ${tag}`);
  return origin;
};

// Enables auth, registers the bootstrap admin, and mints a drawings-only API key.
const mintApiKey = async (origin) => {
  const cookies = new Map();
  let csrf;
  const call = async (method, path, body) => {
    const headers = { "Content-Type": "application/json", Origin: origin };
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (csrf) headers[csrf.header] = csrf.token;
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  const refreshCsrf = async () => {
    csrf = undefined;
    csrf = await call("GET", "/csrf-token");
  };

  await refreshCsrf();
  await call("POST", "/auth/onboarding-choice", { enableAuth: true });
  const setupCode = [...docker("logs", backend).matchAll(
    /One-time admin setup code \([^)]*\): (\S+)/g,
  )].at(-1)?.[1];
  assert.ok(setupCode, "bootstrap setup code printed by the backend");
  await call("POST", "/auth/register", {
    email: "e2e@example.com",
    password: "E2e-Passw0rd!xyz",
    name: "E2E",
    username: "e2e",
    setupCode,
  });
  await refreshCsrf();
  const created = await call("POST", "/auth/api-keys", {
    name: "mcp-e2e",
    scopes: ["drawings:read", "drawings:write"],
  });
  assert.match(created.token, /^exd_/, "API key minted");
  return created.token;
};

const textOf = (result) => {
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const [first] = result.content;
  assert.equal(first?.type, "text");
  return first.text;
};

try {
  const origin = await startExcaliDash();
  const apiKey = await mintApiKey(origin);
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/index.js", import.meta.url).pathname],
    env: { ...process.env, EXCALIDASH_URL: origin, EXCALIDASH_API_KEY: apiKey },
  }));

  try {
    const created = JSON.parse(textOf(await client.callTool({
      name: "create_drawing",
      arguments: { name: "E2E architecture" },
    })));
    const drawingId = created.drawing.id;

    const applied = JSON.parse(textOf(await client.callTool({
      name: "apply_drawing_ops",
      arguments: {
        ops: [
          { op: "add_shape", ref: "api", shape: "rectangle", x: 100, y: 100, w: 240, h: 100, label: "API Gateway" },
          { op: "add_shape", ref: "db", shape: "ellipse", x: 500, y: 100, w: 200, h: 100, label: "PostgreSQL" },
          { op: "connect", fromId: "api", toId: "db", label: "query" },
          { op: "move", id: "db", dx: 0, dy: 200 },
        ],
      },
    })));
    assert.equal(applied.drawingId, drawingId);

    const stored = await fetch(`${origin}/api/drawings/${drawingId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then((r) => r.json());
    assert.equal(stored.version, applied.version, "returned version is the persisted version");

    const live = stored.elements.filter((e) => !e.isDeleted);
    const byId = new Map(live.map((e) => [e.id, e]));
    const shapes = live.filter((e) => e.type === "rectangle" || e.type === "ellipse");
    const arrow = live.find((e) => e.type === "arrow");
    assert.equal(shapes.length, 2, "two shapes persisted");
    assert.ok(arrow, "arrow persisted");
    for (const shape of shapes) {
      const label = live.find((e) => e.type === "text" && e.containerId === shape.id);
      assert.ok(label, `${shape.type} has a bound label`);
      assert.ok(shape.boundElements.some((b) => b.id === label.id), "container lists its label");
      assert.ok(shape.boundElements.some((b) => b.id === arrow.id), "container lists the arrow");
    }
    const db = byId.get(arrow.endBinding.elementId);
    assert.equal(db.type, "ellipse", "arrow ends at the moved ellipse");
    const end = arrow.points.at(-1);
    const endY = arrow.y + end[1];
    assert.ok(endY >= db.y - 10 && endY <= db.y + db.height + 10, "arrow re-routed to the moved shape");

    const summary = textOf(await client.callTool({ name: "get_drawing_summary", arguments: {} }));
    for (const word of ["API Gateway", "PostgreSQL", "query"]) {
      assert.match(summary, new RegExp(word), `summary mentions ${word}`);
    }

    const removed = JSON.parse(textOf(await client.callTool({
      name: "apply_drawing_ops",
      arguments: { ops: [{ op: "delete", id: db.id }] },
    })));
    assert.equal(removed.version, applied.version + 1, "delete is one more version");
    const afterDelete = textOf(await client.callTool({ name: "get_drawing_summary", arguments: {} }));
    assert.doesNotMatch(afterDelete, /PostgreSQL/, "deleted shape gone from summary");

    console.log(`e2e ok: ExcaliDash ${tag}, drawing ${drawingId} at version ${removed.version}`);
  } finally {
    await client.close();
  }
} finally {
  for (const args of [["rm", "-f", frontend, backend], ["network", "rm", network]]) {
    try {
      docker(...args);
    } catch {}
  }
}
