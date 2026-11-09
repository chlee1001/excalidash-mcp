import assert from "node:assert/strict";
import test from "node:test";
import {
  configFromEnv,
  ExcaliDashClient,
  ExcaliDashError,
  VersionConflictError,
  type Fetch,
} from "./excalidash.js";

const config = {
  url: "https://dash.example.test/",
  token: "secret-agent-token",
};
test("config validates credentials", () => {
  assert.deepEqual(
    configFromEnv({
      EXCALIDASH_URL: " https://dash.example.test ",
      EXCALIDASH_API_KEY: " token ",
    }),
    { url: "https://dash.example.test", token: "token", drawingId: undefined },
  );
  assert.throws(() => configFromEnv({}), /EXCALIDASH_URL is required/);
});
test("REST paths, body, and bearer authorization", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: Fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ version: 2 });
  };
  const client = new ExcaliDashClient(config, fetchImpl);
  await client.listDrawings({ search: "two words", limit: 200, offset: 2 });
  await client.createDrawing("new");
  await client.getDrawing("a/b");
  await client.updateScene("a/b", { version: 1, elements: [] });
  assert.equal(
    calls[0]?.url,
    "https://dash.example.test/api/drawings?limit=200&offset=2&search=two+words",
  );
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    name: "new",
    elements: [],
    appState: {},
    files: {},
  });
  assert.equal(calls[2]?.url, "https://dash.example.test/api/drawings/a%2Fb");
  assert.equal(calls[3]?.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[3]?.init?.body)), {
    version: 1,
    elements: [],
  });
  assert.equal(
    new Headers(calls[3]?.init?.headers).get("Authorization"),
    "Bearer secret-agent-token",
  );
});
test("conflicts expose version and errors redact tokens and are bounded", async () => {
  const conflict = new ExcaliDashClient(config, async () =>
    Response.json(
      { currentVersion: 42, message: config.token },
      { status: 409 },
    ),
  );
  await assert.rejects(conflict.getDrawing("x"), (error: unknown) => {
    assert.ok(error instanceof VersionConflictError);
    assert.equal(error.currentVersion, 42);
    assert.doesNotMatch(error.message, /secret-agent-token/);
    return true;
  });
  const failing = new ExcaliDashClient(
    config,
    async () => new Response(config.token + "x".repeat(3000), { status: 422 }),
  );
  await assert.rejects(failing.getDrawing("x"), (error: unknown) => {
    assert.ok(error instanceof ExcaliDashError);
    assert.equal(error.status, 422);
    assert.ok(error.message.length < 2100);
    assert.doesNotMatch(error.message, /secret-agent-token/);
    return true;
  });
});
