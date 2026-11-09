import type { ExcalidrawElement } from "./scene.js";

type SummaryDrawing = {
  id: string;
  name: string;
  version: number;
  elements: ExcalidrawElement[];
  appState?: Record<string, unknown>;
};

const DEFAULT_STYLE: Record<string, unknown> = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  strokeWidth: 2,
  strokeStyle: "solid",
  opacity: 100,
};
const CONNECTOR_TYPES = new Set(["arrow", "line"]);
const MAX_TEXT = 80;
const MAX_WARNINGS = 20;
const OVERLAP_PX = 4;

const num = (value: unknown): string =>
  String(
    Math.round(
      (typeof value === "number" && Number.isFinite(value) ? value : 0) * 100,
    ) / 100,
  );

const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
};

const quote = (text: string | undefined): string =>
  text ? JSON.stringify(oneLine(text)) : "";

const limited = (items: string[]): string[] =>
  items.length > MAX_WARNINGS
    ? [...items.slice(0, MAX_WARNINGS), `… ${items.length - MAX_WARNINGS} more`]
    : items;

class SceneIndex {
  readonly live: ExcalidrawElement[];
  private readonly byId: Map<string, ExcalidrawElement>;
  private readonly labels = new Map<string, ExcalidrawElement>();

  constructor(elements: ExcalidrawElement[]) {
    this.live = elements.filter((el) => !el.isDeleted);
    this.byId = new Map(this.live.map((el) => [el.id, el]));
    for (const el of this.live) {
      if (
        el.type === "text" &&
        el.containerId &&
        this.byId.has(el.containerId)
      ) {
        this.labels.set(el.containerId, el);
      }
    }
  }

  get(id: string | undefined): ExcalidrawElement | undefined {
    return id === undefined ? undefined : this.byId.get(id);
  }

  label(el: ExcalidrawElement): ExcalidrawElement | undefined {
    return this.labels.get(el.id);
  }

  isBoundLabel(el: ExcalidrawElement): boolean {
    return (
      el.type === "text" && !!el.containerId && this.byId.has(el.containerId)
    );
  }

  text(el: ExcalidrawElement): string | undefined {
    if (el.type === "frame")
      return typeof el.name === "string" ? el.name : undefined;
    return this.label(el)?.text ?? el.text;
  }

  describe(id: string | undefined): string {
    const el = this.get(id);
    if (!el) return "(unbound)";
    const text = this.text(el);
    return text ? `${quote(text)} ${el.id}` : `${el.type} ${el.id}`;
  }
}

const styleNotes = (el: ExcalidrawElement): string[] =>
  Object.entries(DEFAULT_STYLE)
    .filter(([key, fallback]) => el[key] !== undefined && el[key] !== fallback)
    .map(([key]) => `${key}=${String(el[key])}`);

const elementLine = (index: SceneIndex, el: ExcalidrawElement): string => {
  const parts = [
    `- ${el.type} ${el.id} at (${num(el.x)}, ${num(el.y)}) ${num(el.width)}×${num(el.height)}`,
    quote(index.text(el)),
  ];
  const style = styleNotes(el);
  if (style.length) parts.push(`[${style.join(" ")}]`);
  if (el.frameId) parts.push(`frame=${el.frameId}`);
  if (el.groupIds?.length) parts.push(`groups=${el.groupIds.join(",")}`);
  if (el.locked === true) parts.push("locked");
  return parts.filter(Boolean).join(" ");
};

const connectionLine = (index: SceneIndex, el: ExcalidrawElement): string => {
  const arrow = el.type === "arrow" ? "→" : "—";
  const label = index.text(el);
  return `- ${index.describe(el.startBinding?.elementId)} ${arrow} ${index.describe(
    el.endBinding?.elementId,
  )} (${el.type} ${el.id}${label ? ` ${quote(label)}` : ""})`;
};

const boundsLine = (live: ExcalidrawElement[]): string => {
  const minX = Math.min(...live.map((el) => el.x));
  const minY = Math.min(...live.map((el) => el.y));
  const maxX = Math.max(...live.map((el) => el.x + el.width));
  const maxY = Math.max(...live.map((el) => el.y + el.height));
  return `Bounds: (${num(minX)}, ${num(minY)}) to (${num(maxX)}, ${num(maxY)}), ${num(
    maxX - minX,
  )}×${num(maxY - minY)}`;
};

const viewportLine = (
  appState: Record<string, unknown> | undefined,
): string | undefined => {
  if (!appState) return undefined;
  const zoom = (appState.zoom as { value?: unknown } | undefined)?.value;
  if (
    typeof appState.scrollX !== "number" &&
    typeof appState.scrollY !== "number" &&
    typeof zoom !== "number"
  ) {
    return undefined;
  }
  return `Viewport: scroll (${num(appState.scrollX)}, ${num(appState.scrollY)}), zoom ${num(zoom ?? 1)}`;
};

const section = (title: string, lines: string[]): string[] =>
  lines.length ? [`${title}:`, ...lines] : [];

// Full containment is deliberate nesting (panels, cards); only partial
// overlaps indicate a layout collision worth fixing.
const contains = (
  outer: ExcalidrawElement,
  inner: ExcalidrawElement,
): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const isConnection = (el: ExcalidrawElement): boolean =>
  CONNECTOR_TYPES.has(el.type) && (!!el.startBinding || !!el.endBinding);

const overlapWarnings = (index: SceneIndex): string[] => {
  const boxes = index.live.filter(
    (el) =>
      !CONNECTOR_TYPES.has(el.type) &&
      el.type !== "frame" &&
      el.type !== "freedraw" &&
      !index.isBoundLabel(el) &&
      el.width > 0 &&
      el.height > 0,
  );
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (
        w > OVERLAP_PX &&
        h > OVERLAP_PX &&
        !contains(a, b) &&
        !contains(b, a)
      )
        found.push(`- overlap: ${a.id} and ${b.id}`);
    }
  }
  return found;
};

const overflowWarnings = (index: SceneIndex): string[] =>
  index.live
    .filter((el) => !CONNECTOR_TYPES.has(el.type) && el.type !== "text")
    .flatMap((container) => {
      const label = index.label(container);
      if (
        !label ||
        (label.width <= container.width && label.height <= container.height)
      )
        return [];
      return [
        `- label ${label.id} overflows ${container.type} ${container.id}`,
      ];
    });

export function summarizeScene(drawing: SummaryDrawing): string {
  const index = new SceneIndex(drawing.elements);
  const header = `Drawing ${quote(drawing.name)} (${drawing.id}) version ${drawing.version}, ${index.live.length} elements`;
  if (index.live.length === 0) {
    return [header, "Empty canvas. Place the first shapes near (0, 0)."].join(
      "\n",
    );
  }

  const counts = new Map<string, number>();
  for (const el of index.live)
    counts.set(el.type, (counts.get(el.type) ?? 0) + 1);
  const groups = new Map<string, string[]>();
  for (const el of index.live) {
    if (index.isBoundLabel(el)) continue;
    for (const group of el.groupIds ?? [])
      groups.set(group, [...(groups.get(group) ?? []), el.id]);
  }
  const connectors = index.live.filter(isConnection);
  const shapes = index.live.filter(
    (el) => !index.isBoundLabel(el) && !isConnection(el),
  );

  return [
    header,
    boundsLine(index.live),
    `Types: ${[...counts].map(([type, count]) => `${type} ${count}`).join(", ")}`,
    viewportLine(drawing.appState),
    ...section(
      "Groups",
      [...groups].map(([group, ids]) => `- ${group}: ${ids.join(", ")}`),
    ),
    ...section(
      "Elements",
      shapes.map((el) => elementLine(index, el)),
    ),
    ...section(
      "Connections",
      connectors.map((el) => connectionLine(index, el)),
    ),
    ...section(
      "Warnings",
      limited([...overlapWarnings(index), ...overflowWarnings(index)]),
    ),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
