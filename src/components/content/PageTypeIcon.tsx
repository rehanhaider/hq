import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { FileText, Globe, Image, Radio, SquarePlay, Video } from "lucide-react";
import { SiGithub, SiX } from "@icons-pack/react-simple-icons";
import { cn } from "cn";
import {
  isSubpage,
  pageTypeIcons,
  subpageTypeIcon,
  type ContentPage,
  type ContentProperties,
  type PageTypeIconKind,
  type Property,
  type PropertyColor,
  type SubpageTypeIconKind,
} from "@/lib/content";
import { chipClass } from "./properties";

const ICONS: Record<PageTypeIconKind, LucideIcon> = {
  youtube: SquarePlay,
  stream: Radio,
  note: FileText,
};

/** Anything that draws a glyph from a class: a Lucide icon or a brand mark. */
type GlyphIcon = ComponentType<{ className?: string }>;

/**
 * One glyph per subpage media type. GitHub and X are places rather than
 * shapes, so they wear their own marks; Lucide has none, and a branch or an
 * at-sign reads as the wrong thing. The rest stay Lucide outlines.
 */
const SUBPAGE_ICONS: Record<SubpageTypeIconKind, GlyphIcon> = {
  website: Globe,
  github: SiGithub,
  tweet: SiX,
  image: Image,
  video: Video,
  file: FileText,
};

const TILE = {
  list: "size-5 rounded-[5px]",
  title: "size-9 rounded-lg",
} as const;
const GLYPH = { list: "size-3.5", title: "size-5" } as const;

type IconSize = keyof typeof TILE;

function Tile({
  Icon,
  color,
  size,
}: {
  Icon: GlyphIcon;
  color: PropertyColor;
  size: IconSize;
}) {
  return (
    <span className={cn("grid shrink-0 place-items-center", TILE[size], chipClass(color))}>
      <Icon className={GLYPH[size]} />
    </span>
  );
}

/**
 * The glyph for whatever the page is: its page types when it stands on its
 * own, its single media type when it hangs under another page. The two lists
 * never mix, so neither does the iconography.
 */
export function PageIcon({
  page,
  properties,
  size = "list",
  className,
}: {
  page: ContentPage;
  properties: ContentProperties;
  size?: IconSize;
  className?: string;
}) {
  if (!isSubpage(page))
    return (
      <PageTypeIcon
        typeIds={page.typeIds}
        types={properties.types}
        size={size}
        className={className}
      />
    );
  return (
    <SubpageTypeIcon
      subpageTypeId={page.subpageTypeId}
      subpageTypes={properties.subpageTypes}
      size={size}
      className={className}
    />
  );
}

/** A subpage's single media glyph, on a tile in its type's colour. */
export function SubpageTypeIcon({
  subpageTypeId,
  subpageTypes,
  size = "list",
  className,
}: {
  subpageTypeId: string | null;
  subpageTypes: Property[];
  size?: IconSize;
  className?: string;
}) {
  const { kind, color } = subpageTypeIcon(subpageTypeId, subpageTypes);
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center", className)}>
      <Tile Icon={SUBPAGE_ICONS[kind]} color={color} size={size} />
    </span>
  );
}

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
  size?: IconSize;
  className?: string;
}) {
  const icons = pageTypeIcons(typeIds, types);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center",
        size === "title" ? "gap-1.5" : "gap-1",
        className,
      )}
    >
      {icons.map(({ kind, color }) => (
        <Tile key={kind} Icon={ICONS[kind]} color={color} size={size} />
      ))}
    </span>
  );
}
