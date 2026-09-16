import type { LucideIcon } from "lucide-react";
import {
  BookOpenText,
  Clapperboard,
  FileText,
  FileType,
  Layers,
  Newspaper,
  Radio,
} from "lucide-react";
import { pageTypeIcon, type PageTypeIcon as PageTypeIconKind, type Property } from "@/lib/content";

const ICONS: Record<PageTypeIconKind, LucideIcon> = {
  page: FileText,
  stream: Radio,
  video: Clapperboard,
  post: Newspaper,
  article: BookOpenText,
  custom: FileType,
  combo: Layers,
};

export function PageTypeIcon({
  typeIds,
  types,
  className = "size-4 shrink-0 text-muted-foreground",
}: {
  typeIds: string[];
  types: Property[];
  className?: string;
}) {
  const Icon = ICONS[pageTypeIcon(typeIds, types)];
  return <Icon aria-hidden className={className} />;
}
