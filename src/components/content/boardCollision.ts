import {
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  type DroppableContainer,
} from "@dnd-kit/core";

/** The column a card belongs to: its `SortableContext` id, which is its column's key. */
const columnOf = (container: DroppableContainer) =>
  container.data.current?.sortable?.containerId as string | undefined;

/**
 * What a dragged card is over: the column under the pointer, then the card in
 * that column closest to the dragged one.
 *
 * `closestCorners` alone matches the card's corners against each droppable's
 * corners across the whole board. Every column is as tall as the fullest one,
 * so an empty column's bottom corners sit far below a card held at its top,
 * and a neighbour left behind in the source column always won. Cards could
 * not leave a full column. So the pointer picks the column, and corners only
 * compete inside it, where they place the card as a sortable list expects,
 * including over the header, between cards, and below the last one.
 *
 * Off every column there is no target, and the card goes back. A keyboard
 * drag has no pointer, so it keeps `closestCorners`, which
 * `sortableKeyboardCoordinates` is built to work with.
 */
export const boardCollision: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCorners(args);
  const column = pointerWithin(args).find((hit) => {
    const container = hit.data?.droppableContainer as DroppableContainer | undefined;
    return container !== undefined && columnOf(container) === undefined;
  });
  if (!column) return [];
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.id === column.id || columnOf(container) === column.id,
    ),
  });
};
