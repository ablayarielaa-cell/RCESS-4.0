import { supabase } from "@/lib/supabase";

// Profile pictures live in their own public bucket, one object per account, so
// replacing a picture overwrites the old one instead of piling up files.
const BUCKET = "avatars";

// Shown inside a small circle, so a square this size is more than enough and
// stays quick to upload on a phone.
const AVATAR_EDGE = 512;
const JPEG_QUALITY = 0.85;

// Mirrors sign_in(), which stores usernames lower-case.
function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function avatarImageUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// A portrait and a landscape photo should both end up as the same circle, so the
// centre square is cropped before resizing.
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const sourceEdge = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(AVATAR_EDGE, sourceEdge);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not read that image. Try a JPG or PNG.");
  }

  ctx.drawImage(
    bitmap,
    Math.round((bitmap.width - sourceEdge) / 2),
    Math.round((bitmap.height - sourceEdge) / 2),
    sourceEdge,
    sourceEdge,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );

  if (!blob) throw new Error("Could not read that image. Try a JPG or PNG.");

  return blob;
}

export async function fetchAvatarPath(username: string): Promise<string> {
  const { data, error } = await supabase
    .from("account_profiles")
    .select("avatar_path")
    .eq("username", normalizeUsername(username))
    .maybeSingle();

  if (error) throw error;

  return String(data?.avatar_path ?? "");
}

export async function uploadAvatar(file: File, username: string): Promise<string> {
  const name = normalizeUsername(username);
  if (!name) throw new Error("Sign in again and try once more.");

  const blob = await toSquareJpeg(file);
  const path = `${name}.jpg`;

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });

  if (upload.error) throw upload.error;

  const { error } = await supabase
    .from("account_profiles")
    .upsert({ username: name, avatar_path: path, updated_at: new Date().toISOString() }, { onConflict: "username" });

  if (error) throw error;

  return path;
}

export async function removeAvatar(username: string): Promise<void> {
  const name = normalizeUsername(username);

  // The row goes first so the picture is gone from every device even when the
  // object cleanup fails; an orphaned file is not shown again.
  const { error } = await supabase
    .from("account_profiles")
    .upsert({ username: name, avatar_path: "", updated_at: new Date().toISOString() }, { onConflict: "username" });

  if (error) throw error;

  await supabase.storage.from(BUCKET).remove([`${name}.jpg`]);
}

function isNetworkFailure(message: string): boolean {
  return /fetch|network|offline|Failed to fetch|ECONN|ENOTFOUND|ENETWORK/i.test(message);
}

// The current password is the only proof of identity this app has, so it is
// checked in the database rather than trusted from the browser.
export async function changePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  let result: Awaited<ReturnType<typeof supabase.rpc>>;

  try {
    result = await supabase.rpc("change_password", {
      p_username: normalizeUsername(username),
      p_current_password: currentPassword,
      p_new_password: newPassword,
    });
  } catch (error) {
    throw new Error(
      isNetworkFailure(error instanceof Error ? error.message : "")
        ? "Could not reach Supabase. Check your connection."
        : "Could not change the password.",
    );
  }

  if (result.error) {
    if (/does not exist|Could not find|schema not found|PGRST202/i.test(result.error.message)) {
      throw new Error("Change password is not set up yet. Run supabase/profile.sql, then reload.");
    }

    throw new Error(
      isNetworkFailure(result.error.message)
        ? "Could not reach Supabase. Check your connection."
        : "Could not change the password.",
    );
  }

  const claim = result.data as { ok?: unknown; error?: unknown } | null;

  if (claim?.ok === true) return;

  const message = typeof claim?.error === "string" ? claim.error : "";
  throw new Error(message || "Could not change the password.");
}
