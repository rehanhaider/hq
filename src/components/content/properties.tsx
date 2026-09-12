import type { ReactNode } from "react";
import { cn } from "cn";
import type { Property, PropertyColor } from "@/lib/content";

/**
 * The palette, written out rather than composed, because Tailwind only keeps
 * class names it can see. Each pair is legible on the card surface in both
 * themes.
 */
const CHIP: Record<PropertyColor, string> = {
  slate: "bg-slate-500/12 text-slate-700 dark:bg-slate-400/18 dark:text-slate-200",
  blue: "bg-blue-500/12 text-blue-700 dark:bg-blue-400/18 dark:text-blue-200",
  teal: "bg-teal-500/12 text-teal-700 dark:bg-teal-400/18 dark:text-teal-200",
  green: "bg-green-600/12 text-green-700 dark:bg-green-400/18 dark:text-green-200",
  amber: "bg-amber-500/16 text-amber-800 dark:bg-amber-400/18 dark:text-amber-200",
  orange: "bg-orange-500/14 text-orange-700 dark:bg-orange-400/18 dark:text-orange-200",
  red: "bg-red-500/12 text-red-700 dark:bg-red-400/18 dark:text-red-200",
  pink: "bg-pink-500/12 text-pink-700 dark:bg-pink-400/18 dark:text-pink-200",
  violet: "bg-violet-500/12 text-violet-700 dark:bg-violet-400/18 dark:text-violet-200",
};

const DOT: Record<PropertyColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  teal: "bg-teal-500",
  green: "bg-green-600",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  pink: "bg-pink-500",
  violet: "bg-violet-500",
};

export function chipClass(color: PropertyColor = "slate") {
  return CHIP[color] ?? CHIP.slate;
}

export function Dot({
  color = "slate",
  className,
}: {
  color?: PropertyColor;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", DOT[color] ?? DOT.slate, className)}
    />
  );
}

export function Chip({
  color = "slate",
  className,
  children,
}: {
  color?: PropertyColor;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        chipClass(color),
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

export function byId(list: Property[], id: string | null | undefined) {
  return id ? list.find((property) => property.id === id) : undefined;
}
