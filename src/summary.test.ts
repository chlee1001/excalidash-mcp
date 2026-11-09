import assert from "node:assert/strict";
import test from "node:test";
import { applyOps, type ExcalidrawElement } from "./scene.js";
import type { Op } from "./ops.js";
import { summarizeScene } from "./summary.js";

const build = (ops: Op[], elements: ExcalidrawElement[] = []) => {
  const result = applyOps(elements, ops, { random: () => 0.25, now: () => 1 });
  assert.ok(result.ok, JSON.stringify(result));
  return result.elements;
};
const summarize = (
  elements: ExcalidrawElement[],
  appState?: Record<string, unknown>,
) => summarizeScene({ id: "d1", name: "Arch", version: 7, elements, appState });
const architecture = () =>
  build([
    {
      op: "add_shape",
      ref: "api",
      shape: "rectangle",
      x: 0,
      y: 0,
      w: 200,
      h: 80,
      label: "API Gateway",
    },
    {
      op: "add_shape",
      ref: "db",
      shape: "ellipse",
      x: 400,
      y: 0,
      w: 180,
      h: 80,
      label: "PostgreSQL",
      style: { backgroundColor: "#b2f2bb" },
    },
    { op: "connect", fromId: "api", toId: "db", label: "query" },
  ]);

test("connections name both endpoints by label", () => {
  const elements = architecture();
  const [api, , db] = elements;
  const summary = summarize(elements);
  assert.match(summary, /^Drawing "Arch" \(d1\) version 7, 6 elements$/m);
  assert.match(
    summary,
    new RegExp(
      `^- "API Gateway" ${api!.id} → "PostgreSQL" ${db!.id} \\(arrow \\S+ "query"\\)$`,
      "m",
    ),
  );
});

test("labels fold into their containers and only non-default style is listed", () => {
  const elements = architecture();
  const summary = summarize(elements);
  const label = elements.find((el) => el.type === "text")!;
  assert.doesNotMatch(summary, new RegExp(`text ${label.id}`));
  assert.match(
    summary,
    /- ellipse \S+ at \(400, 0\) 180×80 "PostgreSQL" \[backgroundColor=#b2f2bb\]/,
  );
  assert.match(summary, /- rectangle \S+ at \(0, 0\) 200×80 "API Gateway"$/m);
});

test("scene metadata covers bounds, types, viewport, groups and frames", () => {
  const base = architecture();
  const [api, , db] = base;
  const grouped = build([{ op: "group", ids: [api!.id, db!.id] }], base);
  const framed: ExcalidrawElement[] = [
    ...grouped,
    {
      id: "f1",
      type: "frame",
      x: -50,
      y: -50,
      width: 700,
      height: 200,
      name: "Backend",
    },
    {
      id: "n1",
      type: "rectangle",
      x: 10,
      y: 100,
      width: 50,
      height: 20,
      frameId: "f1",
    },
  ];
  const summary = summarize(framed, {
    scrollX: 12.345,
    scrollY: -3,
    zoom: { value: 1.5 },
  });
  assert.match(summary, /^Bounds: \(-50, -50\) to \(650, 150\), 700×200$/m);
  assert.match(
    summary,
    /^Types: rectangle 2, text 3, ellipse 1, arrow 1, frame 1$/m,
  );
  assert.match(summary, /^Viewport: scroll \(12\.35, -3\), zoom 1\.5$/m);
  const groupId = grouped[0]!.groupIds![0]!;
  assert.match(
    summary,
    new RegExp(`^- ${groupId}: ${api!.id}, ${db!.id}$`, "m"),
  );
  assert.match(summary, /- frame f1 at \(-50, -50\) 700×200 "Backend"/);
  assert.match(summary, /- rectangle n1 .* frame=f1/);
});

test("warnings flag overlapping shapes and overflowing labels", () => {
  const elements = build([
    {
      op: "add_shape",
      ref: "a",
      shape: "rectangle",
      x: 0,
      y: 0,
      w: 100,
      h: 60,
    },
    {
      op: "add_shape",
      ref: "b",
      shape: "rectangle",
      x: 50,
      y: 30,
      w: 100,
      h: 60,
    },
    {
      op: "add_shape",
      shape: "rectangle",
      x: 400,
      y: 0,
      w: 40,
      h: 30,
      label: "a label far wider than its box",
    },
  ]);
  const summary = summarize(elements);
  assert.match(
    summary,
    new RegExp(`- overlap: ${elements[0]!.id} and ${elements[1]!.id}`),
  );
  assert.match(
    summary,
    new RegExp(`- label \\S+ overflows rectangle ${elements[2]!.id}`),
  );
  assert.doesNotMatch(summarize(architecture()), /Warnings:/);
});

test("nested shapes are not overlaps and free-drawn lines are elements", () => {
  const elements: ExcalidrawElement[] = [
    { id: "panel", type: "rectangle", x: 0, y: 0, width: 400, height: 300 },
    { id: "card", type: "rectangle", x: 20, y: 20, width: 100, height: 60 },
    {
      id: "rule",
      type: "line",
      x: 0,
      y: 320,
      width: 400,
      height: 0,
      points: [
        [0, 0],
        [400, 0],
      ],
    },
  ];
  const summary = summarize(elements);
  assert.doesNotMatch(summary, /overlap/);
  assert.doesNotMatch(summary, /Connections:/);
  assert.match(summary, /^- line rule at \(0, 320\) 400×0$/m);
});

test("deleted elements and unbound arrow ends are reported accurately", () => {
  const elements = architecture();
  const [api] = elements;
  const deleted = build([{ op: "delete", id: api!.id }], elements);
  const summary = summarize(deleted);
  assert.doesNotMatch(summary, /API Gateway/);
  assert.match(summary, /^- \(unbound\) → "PostgreSQL" /m);
  assert.equal(
    summarize([]),
    'Drawing "Arch" (d1) version 7, 0 elements\nEmpty canvas. Place the first shapes near (0, 0).',
  );
});
