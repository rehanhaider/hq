import type { LinkPreviewData } from "@/lib/linkPreview";

/**
 * A link drawn from cached preview data: title, description, and the
 * page's image when it named one. One anchor, so the whole card is the
 * link. The image box has a fixed width and a settled aspect ratio, so the
 * card's height does not move when the image arrives.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function BookmarkCard({ preview }: { preview: LinkPreviewData }) {
  const host = hostOf(preview.url);
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noreferrer nofollow"
      className="bookmark-card flex w-full overflow-hidden rounded-2xl border border-border bg-card text-card-foreground hover:bg-accent"
      data-testid="bookmark-card"
    >
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-4">
        <span className="line-clamp-2 font-medium leading-snug">{preview.title}</span>
        {preview.description ? (
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {preview.description}
          </span>
        ) : null}
        <span className="mt-1 truncate text-xs text-muted-foreground">
          {preview.siteName && preview.siteName !== host
            ? `${preview.siteName} · ${host}`
            : host}
        </span>
      </span>
      {preview.image ? (
        <span className="hidden w-44 shrink-0 bg-muted sm:block">
          <img
            src={preview.image.url}
            alt=""
            width={preview.image.width || undefined}
            height={preview.image.height || undefined}
            decoding="async"
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        </span>
      ) : null}
    </a>
  );
}
