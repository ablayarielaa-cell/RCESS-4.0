import { supabase } from "@/lib/supabase";
import { nanoId } from "@/lib/store";

// Feed photos live in a public Supabase Storage bucket; only their metadata is
// rows in public.feed_posts. Photos stay out of the localStorage store blob so
// a phone picture never has to travel with every other module's save.
const BUCKET = "feed";

// One page of the feed. Loading more asks for a larger window rather than an
// offset, so a fresh post from someone else cannot make a picture repeat.
export const FEED_PAGE_SIZE = 30;

// A post carries a small album, not a whole event. Each picture is resized and
// uploaded one after another, so the ceiling also keeps a post from stalling.
export const MAX_FEED_IMAGES = 10;

// Phone cameras produce 6-10 MB originals; resize before upload.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export type FeedPost = {
  id: string;
  imagePaths: string[];
  caption: string;
  postedBy: string;
  postedAtIso: string;
};

type FeedRow = {
  id: string;
  image_paths: string[] | null;
  caption: string;
  posted_by: string;
  posted_at_iso: string;
};

function rowToPost(row: FeedRow): FeedPost {
  return {
    id: row.id,
    imagePaths: Array.isArray(row.image_paths) ? row.image_paths : [],
    caption: row.caption ?? "",
    postedBy: row.posted_by ?? "",
    postedAtIso: row.posted_at_iso ?? "",
  };
}

export function feedImageUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function listFeed(limit: number = FEED_PAGE_SIZE): Promise<FeedPost[]> {
  const { data, error } = await supabase
    .from("feed_posts")
    .select("id, image_paths, caption, posted_by, posted_at_iso")
    .order("posted_at_iso", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as FeedRow[]).map(rowToPost);
}

// A viewer's own posts, newest first. Filtering in the database keeps "30 per
// page" honest: the page counts their posts instead of the whole feed.
export async function listFeedByUser(
  postedBy: string,
  limit: number = FEED_PAGE_SIZE,
): Promise<{ posts: FeedPost[]; total: number }> {
  const { data, error, count } = await supabase
    .from("feed_posts")
    .select("id, image_paths, caption, posted_by, posted_at_iso", { count: "exact" })
    .eq("posted_by", postedBy)
    .order("posted_at_iso", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return {
    posts: ((data ?? []) as FeedRow[]).map(rowToPost),
    total: count ?? 0,
  };
}

async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not read that image. Try a JPG or PNG.");
  }

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );

  if (!blob) throw new Error("Could not read that image. Try a JPG or PNG.");

  return blob;
}

export async function postToFeed(
  files: File[],
  caption: string,
  postedBy: string,
): Promise<FeedPost> {
  const id = nanoId();
  const imagePaths: string[] = [];

  for (const file of files) {
    const blob = await toJpeg(file);
    // A post can hold several pictures, so each gets its own object name.
    const path = `${id}-${imagePaths.length + 1}.jpg`;

    const upload = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: "image/jpeg" });

    if (upload.error) throw upload.error;

    imagePaths.push(path);
  }

  const post: FeedPost = {
    id,
    imagePaths,
    caption: caption.trim(),
    postedBy,
    postedAtIso: new Date().toISOString(),
  };

  const row: FeedRow = {
    id: post.id,
    image_paths: post.imagePaths,
    caption: post.caption,
    posted_by: post.postedBy,
    posted_at_iso: post.postedAtIso,
  };

  const inserted = await supabase.from("feed_posts").insert(row);
  if (inserted.error) throw inserted.error;

  return post;
}

// The row goes first so the post leaves the feed even when the picture cleanup
// fails; an orphaned file in the bucket is better than a card with a broken image.
export async function deleteFeedPost(post: FeedPost): Promise<void> {
  const { error } = await supabase.from("feed_posts").delete().eq("id", post.id);
  if (error) throw error;

  if (post.imagePaths.length) {
    await supabase.storage.from(BUCKET).remove(post.imagePaths);
  }
}

// Saves through the browser instead of opening the picture in a new tab.
export async function downloadFeedImage(post: FeedPost, path: string): Promise<void> {
  const response = await fetch(feedImageUrl(path));
  if (!response.ok) throw new Error("Could not fetch the picture.");

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `rcess-feed-${post.postedBy || "post"}-${path.replace(/\.jpg$/, "")}.jpg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}
