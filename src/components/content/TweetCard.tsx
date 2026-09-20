import { BadgeCheck, Heart, MessageCircle, Play } from "lucide-react";
import { SiX } from "@icons-pack/react-simple-icons";
import type { TweetEmbedData, TweetPhoto, TweetSegment } from "@/lib/tweetEmbed";

/**
 * A tweet drawn from cached JSON. No script, no iframe, no second paint:
 * whatever the card shows on the first frame is what it keeps showing, so
 * a refresh cannot flash. Every media box carries its own aspect ratio, so
 * the height is settled before an image arrives.
 */

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const countFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Portrait photos would otherwise push the rest of the card off screen. */
function photoRatio(photo: TweetPhoto): string {
  const ratio = photo.width / photo.height;
  if (!Number.isFinite(ratio) || ratio <= 0) return "16 / 9";
  return `${Math.min(Math.max(ratio, 0.75), 2)} / 1`;
}

function TweetText({ segments }: { segments: TweetSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-card-foreground">
      {segments.map((segment, index) =>
        segment.href ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noreferrer nofollow"
            className="tweet-card-link"
          >
            {segment.text}
          </a>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

function TweetPhotos({ photos }: { photos: TweetPhoto[] }) {
  if (photos.length === 0) return null;
  if (photos.length === 1) {
    const photo = photos[0]!;
    return (
      <div
        className="mt-3 overflow-hidden rounded-xl border border-border bg-muted"
        style={{ aspectRatio: photoRatio(photo) }}
      >
        <img
          src={photo.url}
          alt={photo.alt}
          width={photo.width}
          height={photo.height}
          decoding="async"
          className="size-full object-cover"
        />
      </div>
    );
  }
  return (
    <div
      className="mt-3 grid aspect-[16/9] grid-cols-2 gap-0.5 overflow-hidden rounded-xl border border-border bg-muted"
      style={photos.length > 2 ? { gridTemplateRows: "1fr 1fr" } : undefined}
    >
      {photos.map((photo, index) => (
        <img
          key={photo.url}
          src={photo.url}
          alt={photo.alt}
          width={photo.width}
          height={photo.height}
          decoding="async"
          className={
            photos.length === 3 && index === 0
              ? "size-full row-span-2 object-cover"
              : "size-full object-cover"
          }
        />
      ))}
    </div>
  );
}

function TweetVideoBox({
  video,
  permalink,
}: {
  video: NonNullable<TweetEmbedData["video"]>;
  permalink: string;
}) {
  const ratio = `${video.width} / ${video.height}`;
  // `preload="none"` means the poster is the only thing fetched until the
  // reader hits play, so the card still costs one image.
  if (video.src) {
    return (
      <video
        className="mt-3 w-full overflow-hidden rounded-xl border border-border bg-muted"
        style={{ aspectRatio: ratio }}
        poster={video.poster}
        src={video.src}
        preload="none"
        controls
      />
    );
  }
  return (
    <a
      href={permalink}
      target="_blank"
      rel="noreferrer"
      className="group relative mt-3 block overflow-hidden rounded-xl border border-border bg-muted"
      style={{ aspectRatio: ratio }}
    >
      <img src={video.poster} alt="" className="size-full object-cover" decoding="async" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-14 items-center justify-center rounded-full border border-border bg-background/80 text-foreground group-hover:bg-background">
          <Play className="size-6 translate-x-0.5" aria-hidden="true" />
        </span>
      </span>
    </a>
  );
}

export function TweetCard({ tweet }: { tweet: TweetEmbedData }) {
  const profile = `https://x.com/${tweet.handle}`;
  const posted = tweet.createdAt ? new Date(tweet.createdAt) : null;
  return (
    <article className="w-full rounded-2xl border border-border bg-card p-4 text-card-foreground">
      <header className="flex items-start gap-3">
        <a href={profile} target="_blank" rel="noreferrer" className="shrink-0">
          {tweet.avatar ? (
            <img
              src={tweet.avatar}
              alt=""
              width={48}
              height={48}
              decoding="async"
              className="size-12 rounded-full bg-muted object-cover"
            />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-full bg-muted text-lg font-medium text-muted-foreground">
              {tweet.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </a>
        <div className="min-w-0 flex-1">
          <a
            href={profile}
            target="_blank"
            rel="noreferrer"
            className="tweet-card-name flex items-center gap-1 font-medium"
          >
            <span className="truncate">{tweet.name}</span>
            {tweet.verified ? (
              <BadgeCheck className="size-4 shrink-0 text-primary" aria-label="Verified account" />
            ) : null}
          </a>
          <span className="block truncate text-sm text-muted-foreground">
            @{tweet.handle}
          </span>
        </div>
        <a
          href={tweet.permalink}
          target="_blank"
          rel="noreferrer"
          aria-label="View on X"
          className="shrink-0"
        >
          <SiX aria-hidden="true" className="size-4 text-muted-foreground" />
        </a>
      </header>

      <TweetText segments={tweet.segments} />
      <TweetPhotos photos={tweet.photos} />
      {tweet.video ? (
        <TweetVideoBox video={tweet.video} permalink={tweet.permalink} />
      ) : null}

      {tweet.quote ? (
        <a
          href={tweet.quote.permalink}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block rounded-xl border border-border p-3 hover:bg-accent"
        >
          <span className="block text-sm font-medium">
            {tweet.quote.name}{" "}
            <span className="font-normal text-muted-foreground">
              @{tweet.quote.handle}
            </span>
          </span>
          <span className="mt-1 block whitespace-pre-wrap break-words text-sm text-card-foreground">
            {tweet.quote.text}
          </span>
          {tweet.quote.photos.length > 0 ? (
            <TweetPhotos photos={tweet.quote.photos} />
          ) : null}
        </a>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-sm text-muted-foreground">
        {posted ? (
          <time dateTime={tweet.createdAt}>{dateFormat.format(posted)}</time>
        ) : null}
        {tweet.likes > 0 ? (
          <span className="flex items-center gap-1">
            <Heart className="size-4" aria-hidden="true" />
            {countFormat.format(tweet.likes)}
          </span>
        ) : null}
        {tweet.replies > 0 ? (
          <span className="flex items-center gap-1">
            <MessageCircle className="size-4" aria-hidden="true" />
            {countFormat.format(tweet.replies)}
          </span>
        ) : null}
        <a
          href={tweet.permalink}
          target="_blank"
          rel="noreferrer"
          className="tweet-card-action ml-auto"
        >
          View on X
        </a>
      </footer>
    </article>
  );
}
