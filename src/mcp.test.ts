import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("MCP tools use stable REST scenes and retry version conflicts", async () => {
  type Drawing = {
    id: string;
    name: string;
    version: number;
    elements: unknown[];
    appState: object;
    files: object;
  };
  const drawings = new Map<string, Drawing>([
    [
      "drawing-1",
      {
        id: "drawing-1",
        name: "Architecture",
        version: 6,
        elements: [],
        appState: {},
        files: {},
      },
    ],
  ]);
  const versions: number[] = [];
  let conflicts = 1;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-token");
    const url = new URL(req.url ?? "/", "http://localhost");
    let body = "";
    for await (const chunk of req) body += String(chunk);
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/drawings" && req.method === "GET") {
      res.end(
        JSON.stringify({
          drawings: [...drawings.values()],
          totalCount: drawings.size,
          limit: 50,
          offset: 0,
        }),
      );
      return;
    }
    if (url.pathname === "/api/drawings" && req.method === "POST") {
      const input = JSON.parse(body) as Drawing;
      assert.deepEqual(input, {
        name: "New diagram",
        elements: [],
        appState: {},
        files: {},
      });
      const drawing = { ...input, id: "drawing-2", version: 1 };
      drawings.set(drawing.id, drawing);
      res.end(JSON.stringify(drawing));
      return;
    }
    const drawing = drawings.get(url.pathname.split("/").at(-1) ?? "");
    if (!drawing) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "GET") {
      res.end(JSON.stringify(drawing));
      return;
    }
    if (req.method === "PUT") {
      const input = JSON.parse(body) as {
        version: number;
        elements: unknown[];
      };
      versions.push(input.version);
      if (conflicts > 0) {
        conflicts--;
        drawing.version++;
        res.writeHead(409).end(
          JSON.stringify({
            code: "VERSION_CONFLICT",
            currentVersion: drawing.version,
          }),
        );
        return;
      }
      if (input.version !== drawing.version) {
        res
          .writeHead(409)
          .end(JSON.stringify({ currentVersion: drawing.version }));
        return;
      }
      drawing.elements = input.elements;
      drawing.version++;
      res.end(JSON.stringify(drawing));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new Client({ name: "test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("./index.js", import.meta.url).pathname],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      EXCALIDASH_URL: `http://127.0.0.1:${address.port}`,
      EXCALIDASH_API_KEY: "test-token",
    },
  });
  const text = (result: Awaited<ReturnType<typeof client.callTool>>) =>
    result.content[0]?.type === "text" ? result.content[0].text : "";
  try {
    await client.connect(transport);
    assert.deepEqual(
      (await client.listTools()).tools.map((t) => t.name).sort(),
      [
        "apply_drawing_ops",
        "create_drawing",
        "get_drawing_summary",
        "get_selected_drawing",
        "inspect_drawing_element",
        "list_drawings",
        "select_drawing",
      ],
    );
    assert.match(
      text(await client.callTool({ name: "list_drawings", arguments: {} })),
      /drawing-1/,
    );
    assert.match(
      text(
        await client.callTool({
          name: "select_drawing",
          arguments: { drawingId: "drawing-1" },
        }),
      ),
      /drawing-1/,
    );
    const applied = await client.callTool({
      name: "apply_drawing_ops",
      arguments: {
        ops: [
          {
            op: "add_shape",
            shape: "rectangle",
            x: 0,
            y: 0,
            ref: "a",
            label: "Hello",
          },
          {
            op: "add_shape",
            shape: "ellipse",
            x: 300,
            y: 0,
            ref: "b",
            label: "World",
          },
          { op: "connect", fromId: "a", toId: "b" },
        ],
      },
    });
    assert.equal(applied.isError, undefined);
    assert.match(text(applied), /"version": 8/);
    assert.deepEqual(versions, [6, 7]);
    const summary = await client.callTool({
      name: "get_drawing_summary",
      arguments: {},
    });
    assert.match(text(summary), /Hello/);
    assert.match(text(summary), /World/);
    const beforeFailure = versions.length;
    const invalid = await client.callTool({
      name: "apply_drawing_ops",
      arguments: { ops: [{ op: "delete", id: "missing" }] },
    });
    assert.equal(invalid.isError, true);
    assert.equal(versions.length, beforeFailure);
    conflicts = 3;
    const exhausted = await client.callTool({
      name: "apply_drawing_ops",
      arguments: { ops: [{ op: "add_shape", shape: "rectangle", x: 0, y: 0 }] },
    });
    assert.equal(exhausted.isError, true);
    assert.match(text(exhausted), /Drawing changed concurrently 3 times/);
    assert.deepEqual(versions.slice(-3), [8, 9, 10]);
    const created = await client.callTool({
      name: "create_drawing",
      arguments: { name: "New diagram" },
    });
    assert.match(text(created), /drawing-2/);
    assert.match(
      text(
        await client.callTool({ name: "get_selected_drawing", arguments: {} }),
      ),
      /drawing-2/,
    );
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
