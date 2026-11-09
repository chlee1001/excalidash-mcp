import * as z from "zod/v4";

const style = z.strictObject({
  strokeColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]).optional(),
  strokeWidth: z.number().positive().optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  roughness: z.number().min(0).max(2).optional(),
  opacity: z.number().min(0).max(100).optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.number().int().positive().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  roundness: z.enum(["sharp", "round"]).optional(),
});
export const id = z.string().min(1);
export const op = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_shape"),
    ref: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
      .optional(),
    shape: z.enum(["rectangle", "ellipse", "diamond", "text", "frame"]),
    x: z.number(),
    y: z.number(),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
    label: z.string().optional(),
    style: style.optional(),
  }),
  z.object({
    op: z.literal("connect"),
    fromId: id,
    toId: id,
    label: z.string().optional(),
    style: style.optional(),
    arrowType: z.enum(["arrow", "line"]).optional(),
  }),
  z.object({ op: z.literal("set_text"), id, text: z.string() }),
  z.object({ op: z.literal("set_style"), id, style }),
  z
    .object({
      op: z.literal("move"),
      id,
      dx: z.number().optional(),
      dy: z.number().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    })
    .refine(
      (v) =>
        (v.dx !== undefined || v.dy !== undefined) !==
        (v.x !== undefined || v.y !== undefined),
      "move requires either (dx,dy) or (x,y), not both",
    ),
  z.object({
    op: z.literal("resize"),
    id,
    w: z.number().positive(),
    h: z.number().positive(),
  }),
  z.object({
    op: z.literal("align"),
    ids: z.array(id).min(2).max(100),
    alignment: z.enum(["left", "center", "right", "top", "middle", "bottom"]),
  }),
  z.object({
    op: z.literal("distribute"),
    ids: z.array(id).min(2).max(100),
    direction: z.enum(["horizontal", "vertical"]),
    gap: z.number().nonnegative().optional(),
  }),
  z.object({
    op: z.literal("layout"),
    ids: z.array(id).min(1).max(100),
    direction: z.enum(["horizontal", "vertical", "grid"]),
    gap: z.number().nonnegative().max(2000).optional(),
    columns: z.number().int().positive().max(20).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({ op: z.literal("group"), ids: z.array(id).min(2).max(100) }),
  z.object({ op: z.literal("delete"), id }),
  z.object({
    op: z.literal("import_elements"),
    elements: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
  }),
]);
export type Op = z.infer<typeof op>;
