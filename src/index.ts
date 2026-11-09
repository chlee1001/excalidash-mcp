#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  configFromEnv,
  ExcaliDashClient,
  VersionConflictError,
} from "./excalidash.js";
import { id, op } from "./ops.js";
import { applyOps, inspectElement } from "./scene.js";
import { summarizeScene } from "./summary.js";

const MAX_SAVE_ATTEMPTS = 3;

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
});
const errorResult = (error: unknown) => ({
  ...textResult(error instanceof Error ? error.message : String(error)),
  isError: true,
});

export const createServer = (
  client: ExcaliDashClient,
  initialDrawingId?: string,
): McpServer => {
  const server = new McpServer({ name: "excalidash-mcp", version: "0.4.0" });
  let selectedDrawingId = initialDrawingId;
  const resolveDrawingId = (drawingId?: string): string => {
    const resolved = drawingId ?? selectedDrawingId;
    if (!resolved)
      throw new Error(
        "No drawing selected. Call list_drawings and select_drawing first, or pass drawingId.",
      );
    return resolved;
  };
  server.registerTool(
    "list_drawings",
    {
      description:
        "List ExcaliDash drawings available to the account API key. Use this before selecting a drawing.",
      inputSchema: z.object({
        search: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().nonnegative().default(0),
      }),
    },
    async ({ search, limit, offset }) => {
      try {
        return textResult(
          JSON.stringify(
            {
              selectedDrawingId,
              ...(await client.listDrawings({ search, limit, offset })),
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    "select_drawing",
    {
      description:
        "Select a drawing as the default target for subsequent tools in this MCP process.",
      inputSchema: z.object({ drawingId: id }),
    },
    async ({ drawingId }) => {
      try {
        const drawing = await client.getDrawing(drawingId);
        selectedDrawingId = drawing.id;
        return textResult(
          JSON.stringify(
            { selectedDrawingId, name: drawing.name, version: drawing.version },
            null,
            2,
          ),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    "get_selected_drawing",
    {
      description: "Return the drawing currently selected by this MCP process.",
      inputSchema: z.object({}),
    },
    async () =>
      textResult(
        selectedDrawingId
          ? JSON.stringify({ selectedDrawingId })
          : "No drawing selected.",
      ),
  );
  server.registerTool(
    "create_drawing",
    {
      description:
        "Create a new empty Excalidraw drawing and optionally select it as the default target.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200),
        select: z.boolean().default(true),
      }),
    },
    async ({ name, select }) => {
      try {
        const drawing = await client.createDrawing(name);
        if (select) selectedDrawingId = drawing.id;
        return textResult(
          JSON.stringify({ selected: select, drawing }, null, 2),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    "get_drawing_summary",
    {
      description:
        "Read a compact text summary of a drawing: bounds, element types, viewport, groups, one line per element with its label and non-default style, arrows as 'from → to' by label, and warnings for overlapping shapes or overflowing labels. Uses drawingId when provided, otherwise the selected drawing.",
      inputSchema: z.object({ drawingId: id.optional() }),
    },
    async ({ drawingId }) => {
      try {
        return textResult(
          summarizeScene(await client.getDrawing(resolveDrawingId(drawingId))),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    "inspect_drawing_element",
    {
      description:
        "Inspect one element and its bound children. Uses drawingId when provided, otherwise the selected drawing.",
      inputSchema: z.object({ drawingId: id.optional(), elementId: id }),
    },
    async ({ drawingId, elementId }) => {
      try {
        const drawing = await client.getDrawing(resolveDrawingId(drawingId));
        return textResult(
          JSON.stringify(inspectElement(drawing.elements, elementId), null, 2),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    "apply_drawing_ops",
    {
      description:
        "Atomically apply up to 50 semantic operations. Uses drawingId when provided, otherwise the selected drawing. Read the summary first.",
      inputSchema: z.object({
        drawingId: id.optional(),
        ops: z.array(op).min(1).max(50),
      }),
    },
    async ({ drawingId, ops }) => {
      try {
        const resolved = resolveDrawingId(drawingId);
        for (let attempt = 1; ; attempt++) {
          const drawing = await client.getDrawing(resolved);
          const result = applyOps(drawing.elements, ops);
          if (!result.ok)
            return { ...textResult(JSON.stringify(result)), isError: true };
          try {
            const saved = await client.updateScene(resolved, {
              version: drawing.version,
              elements: result.elements,
            });
            return textResult(
              JSON.stringify(
                {
                  drawingId: resolved,
                  version: saved.version,
                  results: result.results,
                  changedIds: result.changedIds,
                },
                null,
                2,
              ),
            );
          } catch (error) {
            if (!(error instanceof VersionConflictError)) throw error;
            if (attempt === MAX_SAVE_ATTEMPTS) {
              throw new Error(
                `Drawing changed concurrently ${MAX_SAVE_ATTEMPTS} times in a row; read the summary and retry.`,
              );
            }
          }
        }
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  return server;
};

const main = async (): Promise<void> => {
  const config = configFromEnv();
  const server = createServer(new ExcaliDashClient(config), config.drawingId);
  await server.connect(new StdioServerTransport());
};
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
