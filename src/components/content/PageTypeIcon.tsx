import type { LucideIcon } from "lucide-react";
import { FileText, Radio, SquarePlay } from "lucide-react";
import { cn } from "cn";
import {
  pageTypeIcons,
  type PageTypeIconKind,
  type Property,
} from "@/lib/content";

const ICONS: Record<PageTypeIconKind, LucideIcon> = {
  youtube: SquarePlay,
  stream: Radio,
  note: FileText,
};

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
  const kinds = pageTypeIcons(typeIds, types);
  const iconClass = size === "title" ? "size-8" : "size-4";
  if (kinds.length === 1) {
    const Icon = ICONS[kinds[0]!];
    return (
      <Icon
        aria-hidden
        className={cn("shrink-0 text-muted-foreground", iconClass, className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center",
        size === "title" ? "-space-x-2.5" : "-space-x-1.5",
        className,
      )}
    >
      {kinds.map((kind) => {
        const Icon = ICONS[kind];
        return (
          <Icon
            key={kind}
            className={cn(
              "shrink-0 bg-card text-muted-foreground",
              iconClass,
            )}
          />
        );
      })}
    </span>
  );
}
