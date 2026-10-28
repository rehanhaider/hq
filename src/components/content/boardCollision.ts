import { closestCorners, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/**
 * What a dragged card is over: whatever is under the pointer.
 *
 * `closestCorners` alone matches the card's corners against each droppable's
 * corners. Every column is as tall as the fullest one, so an empty column's
 * bottom corners sit far below a card held at its top, and a neighbour left
 * behind in the source column always wins. Cards could not leave a full
 * column. The pointer has no such bias: inside a column it picks the card
 * under it, or the column itself between cards, because a card's corners are
 * nearer the pointer than its column's.
 *
 * A keyboard drag has no pointer, so it keeps `closestCorners`, which
 * `sortableKeyboardCoordinates` is built to work with.
 */
export const boardCollision: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCorners(args);
