import type { Op } from "./ops.js";

export type ExcalidrawElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version?: number;
  versionNonce?: number;
  updated?: number;
  isDeleted?: boolean;
  groupIds?: string[];
  frameId?: string | null;
  containerId?: string | null;
  boundElements?: { type: string; id: string }[] | null;
  startBinding?: { elementId: string; focus: number; gap: number } | null;
  endBinding?: { elementId: string; focus: number; gap: number } | null;
  points?: number[][];
  text?: string;
  originalText?: string;
  fontSize?: number;
  [key: string]: unknown;
};
type Style = Extract<Op, { op: "set_style" }>["style"];
type Handler<K extends Op["op"]> = (
  scene: Scene,
  op: Extract<Op, { op: K }>,
) => string[];

class Scene {
  elements: ExcalidrawElement[];
  index = new Map<string, ExcalidrawElement>();
  changed = new Set<string>();
  refs = new Map<string, string>();
  originalNonces = new Map<string, number | undefined>();
  private serial = 0;
  constructor(
    elements: ExcalidrawElement[],
    private random: () => number,
    private now: () => number,
  ) {
    this.elements = structuredClone(elements);
    for (const el of this.elements) {
      this.index.set(el.id, el);
      this.originalNonces.set(el.id, el.versionNonce);
    }
  }
  number(): number {
    return Math.floor(this.random() * 2147483647);
  }
  newId(): string {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    let id: string;
    do {
      id =
        Array.from(
          { length: 16 },
          () => alphabet[Math.floor(this.random() * alphabet.length)] ?? "A",
        ).join("") + (this.serial++).toString(36).padStart(4, "0").slice(-4);
    } while (this.index.has(id));
    return id;
  }
  get(id: string): ExcalidrawElement {
    const el = this.index.get(this.refs.get(id) ?? id);
    if (!el || el.isDeleted)
      throw new Error(`Element not found or deleted: ${id}`);
    return el;
  }
  mutate(el: ExcalidrawElement, patch: Partial<ExcalidrawElement>): void {
    let nonce = this.number();
    while (
      nonce === el.versionNonce ||
      nonce === this.originalNonces.get(el.id)
    )
      nonce = (nonce + 1) % 2147483647;
    Object.assign(el, patch, {
      version: (el.version ?? 0) + 1,
      versionNonce: nonce,
      updated: this.now(),
    });
    this.changed.add(el.id);
  }
  base(
    type: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): ExcalidrawElement {
    return {
      id: this.newId(),
      type,
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness:
        type === "rectangle"
          ? { type: 3 }
          : type === "ellipse" || type === "diamond"
            ? { type: 2 }
            : null,
      seed: this.number(),
      version: 1,
      versionNonce: this.number(),
      isDeleted: false,
      boundElements: null,
      updated: this.now(),
      link: null,
      locked: false,
    };
  }
  add(el: ExcalidrawElement): void {
    this.elements.push(el);
    this.index.set(el.id, el);
    this.originalNonces.set(el.id, el.versionNonce);
    this.changed.add(el.id);
  }
  style(style: Style, type: string): Partial<ExcalidrawElement> {
    const { roundness, ...rest } = style;
    return {
      ...rest,
      ...(roundness === undefined
        ? {}
        : {
            roundness:
              roundness === "sharp"
                ? null
                : { type: type === "rectangle" ? 3 : 2 },
          }),
    };
  }
  text(text: string, x: number, y: number, fontSize = 20): ExcalidrawElement {
    const lines = text.split("\n");
    return {
      ...this.base(
        "text",
        x,
        y,
        Math.max(1, ...lines.map((line) => line.length)) * fontSize * 0.6,
        lines.length * fontSize * 1.25,
      ),
      fontSize,
      fontFamily: 5,
      text,
      originalText: text,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    };
  }
  label(el: ExcalidrawElement, text: string): ExcalidrawElement {
    const child = this.text(text, 0, 0);
    child.containerId = el.id;
    child.textAlign = "center";
    child.verticalAlign = "middle";
    const point = el.points?.[1];
    child.x = el.x + (point?.[0] ?? el.width) / 2 - child.width / 2;
    child.y = el.y + (point?.[1] ?? el.height) / 2 - child.height / 2;
    this.add(child);
    this.mutate(el, {
      boundElements: [
        ...(el.boundElements ?? []),
        { type: "text", id: child.id },
      ],
    });
    return child;
  }
  children(el: ExcalidrawElement): ExcalidrawElement[] {
    return this.elements.filter(
      (child) =>
        !child.isDeleted &&
        (child.containerId === el.id ||
          (el.type === "frame" && child.frameId === el.id)),
    );
  }
  move(
    el: ExcalidrawElement,
    x: number,
    y: number,
    visited = new Set<string>(),
  ): void {
    if (visited.has(el.id)) return;
    visited.add(el.id);
    const dx = x - el.x,
      dy = y - el.y;
    if (!dx && !dy) return;
    this.mutate(el, { x, y });
    for (const child of this.children(el))
      this.move(child, child.x + dx, child.y + dy, visited);
  }
  centerLabel(el: ExcalidrawElement): void {
    const point = el.points?.[1];
    for (const child of this.children(el).filter(
      (c) => c.containerId === el.id,
    ))
      this.move(
        child,
        el.x + (point?.[0] ?? el.width) / 2 - child.width / 2,
        el.y + (point?.[1] ?? el.height) / 2 - child.height / 2,
      );
  }
  routeAll(): void {
    for (const el of this.elements) {
      if (el.isDeleted || (!el.startBinding && !el.endBinding)) continue;
      const a = el.startBinding && this.index.get(el.startBinding.elementId);
      const b = el.endBinding && this.index.get(el.endBinding.elementId);
      if (a?.isDeleted || b?.isDeleted || (!a && !b)) continue;
      const point = el.points?.[1] ?? [el.width, el.height];
      const startPoint: [number, number] = [el.x, el.y];
      const endPoint: [number, number] = [
        el.x + (point[0] ?? 0),
        el.y + (point[1] ?? 0),
      ];
      const placeholder = (point: [number, number]): ExcalidrawElement => ({
        id: "",
        type: "",
        x: point[0],
        y: point[1],
        width: 0,
        height: 0,
      });
      const routed = endpoints(
        a ?? placeholder(startPoint),
        b ?? placeholder(endPoint),
      );
      const start = a ? routed[0] : startPoint,
        end = b ? routed[1] : endPoint;
      const points = [
        [0, 0],
        [end[0] - start[0], end[1] - start[1]],
      ];
      if (
        el.x === start[0] &&
        el.y === start[1] &&
        JSON.stringify(el.points) === JSON.stringify(points)
      )
        continue;
      this.mutate(el, {
        x: start[0],
        y: start[1],
        width: Math.abs(end[0] - start[0]),
        height: Math.abs(end[1] - start[1]),
        points,
      });
      this.centerLabel(el);
    }
  }
}

function endpoints(
  a: ExcalidrawElement,
  b: ExcalidrawElement,
): [[number, number], [number, number]] {
  const ax = a.x + a.width / 2,
    ay = a.y + a.height / 2,
    bx = b.x + b.width / 2,
    by = b.y + b.height / 2;
  const dx = bx - ax || (by === ay ? 1 : 0),
    dy = by - ay;
  const length = Math.hypot(dx, dy);
  const edge = (el: ExcalidrawElement) =>
    Math.min(
      dx ? el.width / 2 / Math.abs(dx) : Infinity,
      dy ? el.height / 2 / Math.abs(dy) : Infinity,
    );
  const ta = edge(a),
    tb = edge(b),
    gx = (dx / length) * 4,
    gy = (dy / length) * 4;
  return [
    [ax + dx * ta + gx, ay + dy * ta + gy],
    [bx - dx * tb - gx, by - dy * tb - gy],
  ];
}

const handlers: { [K in Op["op"]]: Handler<K> } = {
  add_shape(s, op) {
    if (op.ref && (s.refs.has(op.ref) || s.index.has(op.ref)))
      throw new Error(`Duplicate ref: ${op.ref}`);
    const text =
      op.shape === "text"
        ? s.text(op.label ?? "", op.x, op.y, op.style?.fontSize)
        : undefined;
    const el =
      text ??
      s.base(
        op.shape,
        op.x,
        op.y,
        op.w ?? (op.shape === "frame" ? 400 : 160),
        op.h ?? (op.shape === "frame" ? 300 : 80),
      );
    if (text) {
      el.width = op.w ?? el.width;
      el.height = op.h ?? el.height;
    }
    if (op.shape === "frame") el.name = op.label ?? null;
    if (op.style) Object.assign(el, s.style(op.style, el.type));
    s.add(el);
    if (op.ref) s.refs.set(op.ref, el.id);
    const created = [el.id];
    if (
      op.label !== undefined &&
      ["rectangle", "ellipse", "diamond"].includes(op.shape)
    )
      created.push(s.label(el, op.label).id);
    return created;
  },
  connect(s, op) {
    const a = s.get(op.fromId),
      b = s.get(op.toId);
    if (a.id === b.id) throw new Error("Cannot connect an element to itself");
    const [start, end] = endpoints(a, b),
      type = op.arrowType ?? "arrow";
    const el = {
      ...s.base(
        type,
        start[0],
        start[1],
        Math.abs(end[0] - start[0]),
        Math.abs(end[1] - start[1]),
      ),
      points: [
        [0, 0],
        [end[0] - start[0], end[1] - start[1]],
      ],
      startArrowhead: null,
      endArrowhead: type === "arrow" ? "arrow" : null,
      startBinding: { elementId: a.id, focus: 0, gap: 4 },
      endBinding: { elementId: b.id, focus: 0, gap: 4 },
      elbowed: false,
    };
    if (op.style) Object.assign(el, s.style(op.style, type));
    s.add(el);
    for (const shape of [a, b])
      s.mutate(shape, {
        boundElements: [
          ...(shape.boundElements ?? []),
          { type: "arrow", id: el.id },
        ],
      });
    const created = [el.id];
    if (op.label !== undefined) created.push(s.label(el, op.label).id);
    return created;
  },
  set_text(s, op) {
    const el = s.get(op.id);
    if (el.type === "frame") {
      s.mutate(el, { name: op.text });
      return [];
    }
    const target =
      el.type === "text"
        ? el
        : s.children(el).find((child) => child.containerId === el.id);
    if (!target) return [s.label(el, op.text).id];
    const estimate = s.text(op.text, target.x, target.y, target.fontSize ?? 20);
    s.mutate(target, {
      text: op.text,
      originalText: op.text,
      width: estimate.width,
      height: estimate.height,
    });
    if (target.containerId) s.centerLabel(s.get(target.containerId));
    return [];
  },
  set_style(s, op) {
    const el = s.get(op.id);
    s.mutate(el, s.style(op.style, el.type));
    return [];
  },
  move(s, op) {
    const el = s.get(op.id);
    s.move(el, op.x ?? el.x + (op.dx ?? 0), op.y ?? el.y + (op.dy ?? 0));
    s.routeAll();
    return [];
  },
  resize(s, op) {
    const el = s.get(op.id);
    s.mutate(el, { width: op.w, height: op.h });
    s.centerLabel(el);
    s.routeAll();
    return [];
  },
  align(s, op) {
    const els = op.ids.map((id) => s.get(id));
    const first = els[0]!;
    const horizontal = ["left", "center", "right"].includes(op.alignment);
    const factor =
      op.alignment === "center" || op.alignment === "middle"
        ? 0.5
        : op.alignment === "right" || op.alignment === "bottom"
          ? 1
          : 0;
    const anchor = horizontal
      ? first.x + first.width * factor
      : first.y + first.height * factor;
    for (const el of els)
      s.move(
        el,
        horizontal ? anchor - el.width * factor : el.x,
        horizontal ? el.y : anchor - el.height * factor,
      );
    s.routeAll();
    return [];
  },
  distribute(s, op) {
    const horizontal = op.direction === "horizontal",
      els = op.ids
        .map((id) => s.get(id))
        .sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    const pos = (el: ExcalidrawElement) => (horizontal ? el.x : el.y),
      size = (el: ExcalidrawElement) => (horizontal ? el.width : el.height);
    const gap =
      op.gap ??
      (pos(els[els.length - 1]!) +
        size(els[els.length - 1]!) -
        pos(els[0]!) -
        els.reduce((sum, el) => sum + size(el), 0)) /
        (els.length - 1);
    let cursor = pos(els[0]!);
    for (const el of els) {
      s.move(el, horizontal ? cursor : el.x, horizontal ? el.y : cursor);
      cursor += size(el) + gap;
    }
    s.routeAll();
    return [];
  },
  layout(s, op) {
    const els = op.ids.map((id) => s.get(id)),
      gap = op.gap ?? 40,
      cols =
        op.direction === "grid"
          ? (op.columns ?? Math.ceil(Math.sqrt(els.length)))
          : op.direction === "horizontal"
            ? els.length
            : 1;
    const x = op.x ?? els[0]!.x,
      y = op.y ?? els[0]!.y;
    const widths = Array.from({ length: cols }, (_, col) =>
      Math.max(
        0,
        ...els.filter((_, i) => i % cols === col).map((el) => el.width),
      ),
    );
    const rows = Math.ceil(els.length / cols),
      heights = Array.from({ length: rows }, (_, row) =>
        Math.max(
          0,
          ...els.slice(row * cols, (row + 1) * cols).map((el) => el.height),
        ),
      );
    els.forEach((el, i) =>
      s.move(
        el,
        x + widths.slice(0, i % cols).reduce((a, b) => a + b + gap, 0),
        y +
          heights
            .slice(0, Math.floor(i / cols))
            .reduce((a, b) => a + b + gap, 0),
      ),
    );
    s.routeAll();
    return [];
  },
  group(s, op) {
    const els = op.ids.map((id) => s.get(id)),
      group = s.newId(),
      seen = new Set<string>();
    for (const el of els.flatMap((el) => [
      el,
      ...s.children(el).filter((c) => c.containerId === el.id),
    ]))
      if (!seen.has(el.id)) {
        seen.add(el.id);
        s.mutate(el, { groupIds: [...(el.groupIds ?? []), group] });
      }
    return [];
  },
  delete(s, op) {
    const el = s.get(op.id),
      deleted = [el, ...s.children(el).filter((c) => c.containerId === el.id)],
      ids = new Set(deleted.map((e) => e.id));
    for (const item of deleted) s.mutate(item, { isDeleted: true });
    for (const other of s.elements) {
      if (other.isDeleted) continue;
      const bound = other.boundElements?.filter((b) => !ids.has(b.id));
      const start =
        other.startBinding && ids.has(other.startBinding.elementId)
          ? null
          : other.startBinding;
      const end =
        other.endBinding && ids.has(other.endBinding.elementId)
          ? null
          : other.endBinding;
      if (
        bound?.length !== other.boundElements?.length ||
        start !== other.startBinding ||
        end !== other.endBinding
      )
        s.mutate(other, {
          boundElements: bound ?? other.boundElements,
          startBinding: start,
          endBinding: end,
        });
    }
    return [];
  },
  import_elements(s, op) {
    const created: string[] = [];
    for (const input of op.elements) {
      if (
        typeof input.type !== "string" ||
        typeof input.x !== "number" ||
        typeof input.y !== "number" ||
        typeof input.width !== "number" ||
        typeof input.height !== "number"
      )
        throw new Error(
          "Imported element requires type, x, y, width and height",
        );
      const base = s.base(
          input.type,
          input.x,
          input.y,
          input.width,
          input.height,
        ),
        id = typeof input.id === "string" && input.id ? input.id : base.id;
      const existing = s.index.get(id);
      if (existing && !existing.isDeleted)
        throw new Error(`Element id already exists: ${id}`);
      const el = { ...base, ...input, id } as ExcalidrawElement;
      if (existing) s.mutate(existing, { ...el, isDeleted: false });
      else s.add(el);
      created.push(id);
    }
    return created;
  },
};

export function applyOps(
  elements: ExcalidrawElement[],
  ops: Op[],
  deps: { random?: () => number; now?: () => number } = {},
):
  | {
      ok: true;
      elements: ExcalidrawElement[];
      results: { opIndex: number; createdIds: string[] }[];
      changedIds: string[];
    }
  | { ok: false; errors: { opIndex: number; message: string }[] } {
  const scene = new Scene(
      elements,
      deps.random ?? Math.random,
      deps.now ?? Date.now,
    ),
    results: { opIndex: number; createdIds: string[] }[] = [];
  for (const [opIndex, op] of ops.entries()) {
    try {
      const handler = handlers[op.op] as (scene: Scene, op: Op) => string[];
      results.push({ opIndex, createdIds: handler(scene, op) });
    } catch (error) {
      return {
        ok: false,
        errors: [
          {
            opIndex,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
  return {
    ok: true,
    elements: scene.elements,
    results,
    changedIds: [...scene.changed],
  };
}

export function inspectElement(
  elements: ExcalidrawElement[],
  id: string,
): { element: ExcalidrawElement; children: ExcalidrawElement[] } {
  const element = elements.find((el) => el.id === id && !el.isDeleted);
  if (!element) throw new Error(`Element not found or deleted: ${id}`);
  return {
    element,
    children: elements.filter(
      (el) => !el.isDeleted && (el.containerId === id || el.frameId === id),
    ),
  };
}

export function summarizeScene(drawing: {
  id: string;
  name: string;
  version: number;
  elements: ExcalidrawElement[];
}): string {
  const active = drawing.elements.filter((el) => !el.isDeleted);
  const lines = active
    .filter((el) => !el.containerId)
    .map((el) => {
      const label = active.find(
        (child) => child.containerId === el.id && child.type === "text",
      );
      const text =
        label?.text ??
        el.text ??
        (typeof el.name === "string" ? el.name : undefined);
      return `- ${el.type} ${el.id} (${el.x}, ${el.y}, ${el.width}×${el.height})${text !== undefined ? `: ${text}` : ""}`;
    });
  return [
    `Drawing: ${drawing.name} (${drawing.id}), version ${drawing.version}`,
    ...lines,
  ].join("\n");
}
