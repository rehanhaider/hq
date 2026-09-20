import type { LucideIcon } from "lucide-react";
import {
  AtSign,
  FileText,
  GitBranch,
  Globe,
  Image,
  Radio,
  SquarePlay,
  Video,
} from "lucide-react";
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

/**
 * One glyph per subpage media type. Lucide dropped its brand marks, so a
 * repository is a branch and a tweet is an at-sign: the shape of the thing
 * rather than the logo.
 */
const SUBPAGE_ICONS: Record<SubpageTypeIconKind, LucideIcon> = {
  website: Globe,
  github: GitBranch,
  tweet: AtSign,
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
  Icon: LucideIcon;
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
