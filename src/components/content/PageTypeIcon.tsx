import type { LucideIcon } from "lucide-react";
import { FileText, Radio, SquarePlay } from "lucide-react";
import { cn } from "cn";
import {
  pageTypeIcons,
  type PageTypeIconKind,
  type Property,
} from "@/lib/content";
import { chipClass } from "./properties";

const ICONS: Record<PageTypeIconKind, LucideIcon> = {
  youtube: SquarePlay,
  stream: Radio,
  note: FileText,
};

/**
 * Each glyph sits on a tile in its type's colour, the same pair the property
 * chips use, so the icon and the chip always agree. Mixed types draw one tile
 * each, side by side; outline glyphs have no body, so overlapping them only
 * tangles the strokes.
 */
export function PageTypeIcon({
  typeIds,
  types,
  size = "list",
  className,
}: {
  typeIds: string[];
  types: Property[];
  size?: "list" | "title";
  className?: string;
}) {
  const icons = pageTypeIcons(typeIds, types);
  const tileClass =
    size === "title" ? "size-9 rounded-lg" : "size-5 rounded-[5px]";
  const glyphClass = size === "title" ? "size-5" : "size-3.5";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center",
        size === "title" ? "gap-1.5" : "gap-1",
        className,
      )}
    >
      {icons.map(({ kind, color }) => {
        const Icon = ICONS[kind];
        return (
          <span
            key={kind}
            className={cn(
              "grid shrink-0 place-items-center",
              tileClass,
              chipClass(color),
            )}
          >
            <Icon className={glyphClass} />
          </span>
        );
      })}
    </span>
  );
}
