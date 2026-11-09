import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOps,
  inspectElement,
  summarizeScene,
  type ExcalidrawElement,
} from "./scene.js";
import { op, type Op } from "./ops.js";

const deps = { random: () => 0.25, now: () => 123 };
function run(elements: ExcalidrawElement[], ops: Op[]) {
  const result = applyOps(elements, ops, deps);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}
const initial = () =>
  run(
    [],
    [
      { op: "add_shape", shape: "rectangle", x: 0, y: 0, ref: "a", label: "A" },
      { op: "add_shape", shape: "ellipse", x: 300, y: 0, ref: "b", label: "B" },
      { op: "connect", fromId: "a", toId: "b", label: "edge" },
    ],
  );
test("labels, refs, connections and summary", () => {
  const result = initial(),
    a = result.elements[0]!,
    label = result.elements[1]!,
    arrow = result.elements[4]!;
  assert.equal(label.containerId, a.id);
  assert.ok(a.boundElements?.some((b) => b.id === label.id));
  assert.deepEqual(arrow.points?.[0], [0, 0]);
  assert.equal(arrow.x, a.x + a.width + 4);
  assert.equal(arrow.startBinding?.elementId, a.id);
  assert.equal(arrow.endBinding?.elementId, result.elements[2]?.id);
  assert.ok(a.boundElements?.some((b) => b.id === arrow.id));
  assert.equal(inspectElement(result.elements, a.id).children[0]?.id, label.id);
  const summary = summarizeScene({
    id: "d",
    name: "N",
    version: 1,
    elements: result.elements,
  });
  assert.match(summary, /rectangle.*: A/);
  assert.doesNotMatch(summary, new RegExp(`text ${label.id}`));
});
test("move and resize carry labels, frames and reroute connections", () => {
  const before = initial(),
    a = before.elements[0]!,
    text = before.elements[1]!,
    arrow = before.elements[4]!;
  const moved = run(before.elements, [
    { op: "move", id: a.id, dx: 20, dy: 30 },
    { op: "resize", id: a.id, w: 200, h: 100 },
  ]);
  assert.notEqual(moved.elements[4]!.x, arrow.x);
  assert.notEqual(moved.elements[1]!.x, text.x);
  for (const id of moved.changedIds) {
    const old = before.elements.find((e) => e.id === id)!,
      next = moved.elements.find((e) => e.id === id)!;
    assert.ok(next.version! > old.version!);
    assert.notEqual(next.versionNonce, old.versionNonce);
  }
  const frame = run([], [{ op: "add_shape", shape: "frame", x: 0, y: 0 }])
    .elements[0]!;
  const child: ExcalidrawElement = {
    id: "child",
    type: "rectangle",
    x: 5,
    y: 5,
    width: 10,
    height: 10,
    frameId: frame.id,
    version: 1,
  };
  const framed = run(
    [frame, child],
    [{ op: "move", id: frame.id, dx: 10, dy: 20 }],
  );
  assert.equal(framed.elements[1]?.x, 15);
  assert.equal(framed.elements[1]?.y, 25);
});
test("delete marks labels deleted and unbinds arrows", () => {
  const before = initial(),
    a = before.elements[0]!,
    result = run(before.elements, [{ op: "delete", id: a.id }]);
  assert.equal(result.elements[0]?.isDeleted, true);
  assert.equal(result.elements[1]?.isDeleted, true);
  assert.equal(result.elements[4]?.startBinding, null);
  assert.equal(result.elements[4]?.isDeleted, false);
  assert.doesNotMatch(
    summarizeScene({
      id: "d",
      name: "N",
      version: 1,
      elements: result.elements,
    }),
    /rectangle/,
  );
});
test("atomic failures and import collisions leave input unchanged", () => {
  const before = initial().elements,
    copy = structuredClone(before);
  const failed = applyOps(
    before,
    [
      { op: "move", id: before[0]!.id, dx: 1 },
      { op: "delete", id: "missing" },
    ],
    deps,
  );
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.errors[0]?.opIndex, 1);
  assert.deepEqual(before, copy);
  const collision = applyOps(
    before,
    [
      {
        op: "import_elements",
        elements: [
          {
            id: before[0]!.id,
            type: "rectangle",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        ],
      },
    ],
    deps,
  );
  assert.equal(collision.ok, false);
});
test("text, style, group, alignment, distribution and layout", () => {
  const before = initial(),
    a = before.elements[0]!,
    b = before.elements[2]!;
  const result = run(before.elements, [
    { op: "set_text", id: a.id, text: "Changed" },
    {
      op: "set_style",
      id: a.id,
      style: { strokeColor: "red", roundness: "sharp" },
    },
    { op: "group", ids: [a.id, b.id] },
    { op: "align", ids: [a.id, b.id], alignment: "top" },
    { op: "distribute", ids: [a.id, b.id], direction: "horizontal", gap: 30 },
    {
      op: "layout",
      ids: [a.id, b.id],
      direction: "vertical",
      gap: 10,
      x: 50,
      y: 60,
    },
  ]);
  assert.equal(result.elements[1]?.text, "Changed");
  assert.equal(result.elements[0]?.strokeColor, "red");
  assert.equal(result.elements[0]?.roundness, null);
  assert.deepEqual(result.elements[0]?.groupIds, result.elements[1]?.groupIds);
  assert.equal(result.elements[0]?.x, 50);
  assert.equal(result.elements[2]?.y, 150);
  assert.equal(
    op.safeParse({ op: "set_style", id: "a", style: { unexpected: true } })
      .success,
    false,
  );
});
test("import fills missing fields and assigns an id", () => {
  const result = run(
    [],
    [
      {
        op: "import_elements",
        elements: [
          {
            type: "rectangle",
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            custom: "kept",
          },
        ],
      },
    ],
  );
  assert.equal(result.elements[0]?.custom, "kept");
  assert.equal(result.elements[0]?.version, 1);
  assert.equal(result.elements[0]?.id.length, 20);
});
test("reverse arrows center labels and reroute after one endpoint is deleted", () => {
  const result = run(
    [],
    [
      { op: "add_shape", shape: "rectangle", x: 300, y: 100, ref: "a" },
      { op: "add_shape", shape: "rectangle", x: 0, y: 0, ref: "b" },
      { op: "connect", fromId: "a", toId: "b", label: "reverse" },
    ],
  );
  const arrow = result.elements[2]!,
    label = result.elements[3]!,
    point = arrow.points![1]!;
  assert.equal(label.x + label.width / 2, arrow.x + point[0]! / 2);
  assert.equal(label.y + label.height / 2, arrow.y + point[1]! / 2);
  const next = run(result.elements, [
    { op: "delete", id: result.elements[1]!.id },
    { op: "move", id: result.elements[0]!.id, dx: 20 },
  ]);
  assert.equal(next.elements[2]?.endBinding, null);
  assert.notEqual(next.elements[2]?.x, arrow.x);
});
test("import can replace a deleted element without duplicating its id", () => {
  const existing: ExcalidrawElement = {
    id: "old",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    version: 4,
    isDeleted: true,
  };
  const result = run(
    [existing],
    [
      {
        op: "import_elements",
        elements: [
          { id: "old", type: "ellipse", x: 2, y: 3, width: 4, height: 5 },
        ],
      },
    ],
  );
  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0]?.isDeleted, false);
  assert.equal(result.elements[0]?.version, 5);
});
test("set_text creates labels, resizes text, and names frames", () => {
  const created = run(
    [],
    [
      { op: "add_shape", shape: "rectangle", x: 0, y: 0 },
      { op: "add_shape", shape: "frame", x: 0, y: 0, label: "original" },
      { op: "add_shape", shape: "text", x: 0, y: 0, label: "x" },
    ],
  );
  const result = run(created.elements, [
    { op: "set_text", id: created.elements[0]!.id, text: "new label" },
    { op: "set_text", id: created.elements[1]!.id, text: "renamed" },
    {
      op: "set_text",
      id: created.elements[2]!.id,
      text: "more text\non two lines",
    },
  ]);
  assert.equal(result.elements[3]?.containerId, result.elements[0]?.id);
  assert.equal(result.elements[1]?.name, "renamed");
  assert.equal(result.elements[2]?.height, 50);
  assert.equal(result.elements[2]?.originalText, "more text\non two lines");
  assert.equal(
    inspectElement(result.elements, created.elements[1]!.id).children.length,
    0,
  );
});
