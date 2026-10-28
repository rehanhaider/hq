import { describe, expect, it } from "vitest";
import { closestCorners, type CollisionDetection, type ClientRect } from "@dnd-kit/core";
import { boardCollision } from "./boardCollision";

type Args = Parameters<CollisionDetection>[0];

const rect = (left: number, top: number, width: number, height: number): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

// The board from issue #153: nine cards in Idea, Planned empty, and both
// columns as tall as the fuller one.
const COLUMN_TOP = 124;
const COLUMN_HEIGHT = 833;
const CARD_HEIGHT = 65;
const idea = rect(288, COLUMN_TOP, 272, COLUMN_HEIGHT);
const planned = rect(572, COLUMN_TOP, 272, COLUMN_HEIGHT);
const card = (column: ClientRect, index: number) =>
  rect(column.left + 9, 165 + index * 73, 254, CARD_HEIGHT);

function board(extra: Record<string, ClientRect> = {}) {
  const rects: Record<string, ClientRect> = { idea, planned, ...extra };
  for (let index = 0; index < 9; index++) rects[`idea-${index}`] = card(idea, index);
  return rects;
}

function args(
  rects: Record<string, ClientRect>,
  collisionRect: ClientRect,
  pointerCoordinates: { x: number; y: number } | null,
): Args {
  return {
    active: { id: "idea-0" },
    collisionRect,
    droppableRects: new Map(Object.entries(rects)),
    droppableContainers: Object.keys(rects).map((id) => ({ id })),
    pointerCoordinates,
  } as unknown as Args;
}

/** The first card of Idea, held at the top of Planned with the pointer at its centre. */
const heldOverPlanned = rect(planned.left + 9, 165, 254, CARD_HEIGHT);
const pointerOverPlanned = { x: planned.left + 136, y: 197 };

describe("board collision", () => {
  it("lets a card leave a full column for an empty one", () => {
    const input = args(board(), heldOverPlanned, pointerOverPlanned);
    // The bug: matching corners, a card left behind in Idea is closer than
    // the empty column the card is held over.
    expect(closestCorners(input)[0]?.id).toMatch(/^idea-/);
    expect(boardCollision(input)[0]?.id).toBe("planned");
  });

  it("lets a card leave from the bottom of a full column", () => {
    const held = rect(planned.left + 9, card(idea, 8).top, 254, CARD_HEIGHT);
    const input = args(board(), held, { x: planned.left + 136, y: held.top + 32 });
    expect(boardCollision(input)[0]?.id).toBe("planned");
  });

  it("is over the card under the pointer, not the column around it", () => {
    const input = args(
      board({ "planned-0": card(planned, 0) }),
      heldOverPlanned,
      pointerOverPlanned,
    );
    expect(boardCollision(input).map((collision) => collision.id)).toEqual([
      "planned-0",
      "planned",
    ]);
  });

  it("is over nothing when the pointer is between columns", () => {
    const input = args(board(), heldOverPlanned, { x: idea.right + 6, y: 197 });
    expect(boardCollision(input)).toEqual([]);
  });

  it("keeps closest corners for a keyboard drag, which has no pointer", () => {
    const input = args(board(), heldOverPlanned, null);
    expect(boardCollision(input)).toEqual(closestCorners(input));
  });
});
