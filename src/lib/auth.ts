import { supabase } from "@/lib/supabase";

export type Role = "guest" | "viewer" | "admin" | "staff" | "sports";

const ROLES: Role[] = ["guest", "viewer", "admin", "staff", "sports"];
const USERNAME_PATTERN = /^[a-z0-9._-]{2,64}$/;

// The session lives in this browser only. Supabase holds the accounts and does
// the password check; see the sign_in() function in supabase/schema.sql.
const LS_KEY = "rcess.session.v2";

export type Session = {
  role: Role;
  username?: string;
};

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

function isValidRole(role: unknown): role is Role {
  return typeof role === "string" && ROLES.includes(role as Role);
}

// Reads the last known session so the UI can render before anyone signs in.
export function getSession(): Session {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { role: "guest" };

    const parsed = JSON.parse(raw) as Session;
    if (!isValidRole(parsed?.role)) return { role: "guest" };

    return parsed;
  } catch {
    return { role: "guest" };
  }
}

function setSession(session: Session) {
  localStorage.setItem(LS_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(LS_KEY);
}

export function continueAsGuest(): Session {
  const session: Session = { role: "guest", username: "guest" };
  setSession(session);
  return session;
}

// supabase-js reports a transport failure the same way it reports a rejected
// call, so a request that never left the browser must not read as a bad password.
function isNetworkFailure(message: string): boolean {
  return /fetch|network|offline|Failed to fetch|ECONN|ENOTFOUND|ENETWORK/i.test(message);
}

function describeFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");

  return isNetworkFailure(message)
    ? "Could not reach Supabase. Check your connection."
    : message;
}

export async function signInWithUsername(
  username: string,
  password: string,
): Promise<Session> {
  const normalized = normalizeUsername(username);

  if (!isValidUsername(normalized)) {
    throw new Error("Usernames may only contain letters, numbers, dot, dash or underscore.");
  }

  if (!password) throw new Error("Enter your password.");

  let result: Awaited<ReturnType<typeof supabase.rpc>>;

  try {
    result = await supabase.rpc("sign_in", {
      p_username: normalized,
      p_password: password,
    });
  } catch (error) {
    throw new Error(describeFailure(error) || "Invalid username or password.");
  }

  if (result.error) {
    // A missing function means the accounts table has not been created yet.
    if (/does not exist|Could not find|schema not found|PGRST202/i.test(result.error.message)) {
      throw new Error(
        "The accounts table is not set up yet. Run the SQL in supabase/schema.sql, then restart the dev server.",
      );
    }

    throw new Error(
      isNetworkFailure(result.error.message)
        ? describeFailure(result.error)
        : result.error.message || "Invalid username or password.",
    );
  }

  const claim = result.data as { role?: unknown; username?: unknown } | null;

  if (!claim || !isValidRole(claim.role)) {
    // sign_in() answers identically for an unknown username and a wrong
    // password, so account names cannot be listed from the login page.
    throw new Error("Invalid username or password.");
  }

  const session: Session = {
    role: claim.role,
    username: typeof claim.username === "string" ? claim.username : normalized,
  };

  setSession(session);
  return session;
}
