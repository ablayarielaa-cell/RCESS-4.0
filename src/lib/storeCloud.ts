import { supabase } from "@/lib/supabase";
import { defaults, migrateStore } from "@/lib/store";
import type { Bracket, NewsItem, ScoreRow, Store } from "@/lib/store";

function fail(table: string, message: string): never {
  throw new Error(`${table}: ${message}`);
}

async function rowsOf(table: string): Promise<any[]> {
  const { data, error } = await supabase.from(table).select("*");
  if (error) fail(table, error.message);
  return data ?? [];
}

// The portal keeps one row per singleton module, always with id = 1.
async function singletonOf(table: string): Promise<any | null> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) fail(table, error.message);
  return data ?? null;
}

export async function fetchStore(): Promise<Store> {
  const [settings, news, schedule, summit, map, leaderboard, brackets, evaluation] =
    await Promise.all([
      singletonOf("app_settings"),
      rowsOf("news"),
      rowsOf("schedule_posts"),
      singletonOf("summit_info"),
      singletonOf("map_info"),
      rowsOf("leaderboard_rows"),
      rowsOf("brackets"),
      singletonOf("evaluation_form"),
    ]);

  const emptyDatabase =
    !settings && !news.length && !schedule.length && !summit && !map && !leaderboard.length && !brackets.length;

  if (emptyDatabase) return defaults();

  return migrateStore({
    settings: settings
      ? {
          countdownIso: settings.countdown_iso,
          countdownClosed: settings.countdown_closed,
          bracketAutoAdvance: settings.bracket_auto_advance,
          sports: settings.sports,
          // Absent until supabase/events.sql has been run; migrateStore then
          // rebuilds the catalogue from the flat sports list.
          events: settings.events,
          permissions: settings.permissions,
        }
      : undefined,

    // News is the one collection whose column and field names differ, so map it
    // like the others — an unmapped row has no postedAtIso and cannot be saved
    // back to a table whose posted_at_iso column has no default.
    news: news.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      type: row.type,
      postedAtIso: row.posted_at_iso,
    })),

    schedule: schedule.map((row) => ({
      id: row.id,
      title: row.title,
      location: row.location,
      timeText: String(row.time_iso ?? ""),
      postedAtIso: row.posted_at_iso,
      visibleFromIso: row.visible_from_iso ?? "",
      visibleToIso: row.visible_to_iso ?? "",
    })),

    summit: summit
      ? {
          title: summit.title,
          subtitle: summit.subtitle,
          venue: summit.venue,
          dateLabel: summit.date_label,
          notes: summit.notes,
        }
      : undefined,

    map: map
      ? { embedUrl: map.embed_url, notes: map.notes, locations: map.locations }
      : undefined,

    leaderboard: leaderboard.map((row) => ({
      id: row.id,
      team: row.team,
      points: row.points,
      sport: row.sport,
    })),

    brackets: brackets.map((row) => ({
      id: row.id,
      sport: row.sport,
      name: row.name,
      format: row.format,
      teams: row.teams,
      rounds: row.rounds,
      losersRounds: row.losers_rounds,
      grandFinal: row.grand_final,
      standings: row.standings ?? undefined,
    })),

    evaluation: evaluation
      ? {
          title: evaluation.title,
          description: evaluation.description,
          opensAtIso: evaluation.opens_at_iso,
          closesAtIso: evaluation.closes_at_iso,
          questions: evaluation.questions,
        }
      : undefined,
  });
}

// Writes a collection to match the given rows exactly: upsert the wanted rows,
// delete the rows that are gone. Existing ids are read first so the delete uses
// a bound id list instead of an interpolated filter.
async function syncCollection(table: string, rows: Array<Record<string, any>>) {
  const wanted = new Set(rows.map((row) => String(row.id)));

  const { data: existing, error: readError } = await supabase
    .from(table)
    .select("id");

  if (readError) fail(table, readError.message);

  const stale = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !wanted.has(id));

  if (stale.length) {
    const { error } = await supabase.from(table).delete().in("id", stale);
    if (error) fail(table, error.message);
  }

  if (rows.length) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
    if (error) fail(table, error.message);
  }
}

async function syncSingleton(table: string, row: Record<string, any>) {
  const { error } = await supabase.from(table).upsert({ id: 1, ...row }, { onConflict: "id" });
  if (error) fail(table, error.message);
}

type ModuleKey =
  | "settings"
  | "summit"
  | "map"
  | "news"
  | "schedule"
  | "leaderboard"
  | "brackets"
  | "evaluation";

const MODULE_TABLE: Record<ModuleKey, string> = {
  settings: "app_settings",
  summit: "summit_info",
  map: "map_info",
  news: "news",
  schedule: "schedule_posts",
  leaderboard: "leaderboard_rows",
  brackets: "brackets",
  evaluation: "evaluation_form",
};

const ALL_MODULES = Object.keys(MODULE_TABLE) as ModuleKey[];

// "events-not-stored" is not a rejected save: the settings reached the cloud,
// only the catalogue column that supabase/events.sql adds is still missing.
type WriteOutcome = "stored" | "events-not-stored";

function isMissingColumnError(error: any, column: string): boolean {
  const message = String(error?.message ?? "");
  return (
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    (message.includes(column) && /could not find|does not exist/i.test(message))
  );
}

async function writeSettings(store: Store): Promise<WriteOutcome> {
  const row = {
    countdown_iso: store.settings.countdownIso,
    countdown_closed: store.settings.countdownClosed,
    bracket_auto_advance: store.settings.bracketAutoAdvance,
    sports: store.settings.sports,
    permissions: store.settings.permissions,
    events: store.settings.events,
  };

  const first = await supabase
    .from("app_settings")
    .upsert({ id: 1, ...row }, { onConflict: "id" });

  if (!first.error) return "stored";
  if (!isMissingColumnError(first.error, "events")) fail("app_settings", first.error.message);

  // Everything else in Settings still has to save on a project where the events
  // SQL was never run, so retry without the column. supabase-js drops a key whose
  // value is undefined, so it stays out of the payload entirely.
  const retry = await supabase
    .from("app_settings")
    .upsert({ id: 1, ...row, events: undefined }, { onConflict: "id" });

  if (retry.error) fail("app_settings", retry.error.message);
  return "events-not-stored";
}

async function writeModule(key: ModuleKey, store: Store): Promise<WriteOutcome> {
  const table = MODULE_TABLE[key];

  if (key === "settings") return writeSettings(store);

  if (key === "summit") {
    await syncSingleton(table, {
      title: store.summit.title,
      subtitle: store.summit.subtitle,
      venue: store.summit.venue,
      date_label: store.summit.dateLabel,
      notes: store.summit.notes,
    });
    return "stored";
  }

  if (key === "map") {
    await syncSingleton(table, {
      embed_url: store.map.embedUrl,
      notes: store.map.notes,
      locations: store.map.locations ?? [],
    });
    return "stored";
  }

  if (key === "news") {
    const rows = store.news.map((item: NewsItem) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      type: item.type,
      // Never leave the column out: an inserted row without it is rejected.
      posted_at_iso: item.postedAtIso || new Date().toISOString(),
    }));
    await syncCollection(table, rows);
    return "stored";
  }

  if (key === "schedule") {
    const rows = store.schedule.map((post) => ({
      id: post.id,
      // A post no longer has a sport, but the column is still NOT NULL, so every
      // row is written with the same placeholder.
      sport: "General",
      title: post.title,
      location: post.location,
      // The column is still named time_iso but now holds whatever the admin typed.
      time_iso: post.timeText,
      posted_at_iso: post.postedAtIso,
      visible_from_iso: post.visibleFromIso ?? "",
      visible_to_iso: post.visibleToIso ?? "",
      // The viewer no longer shows a status, but the table still checks it, so
      // every row is written as the value the constraint accepts.
      status: "Starting",
    }));
    await syncCollection(table, rows);
    return "stored";
  }

  if (key === "leaderboard") {
    const rows = store.leaderboard.map((row: ScoreRow) => ({
      id: row.id,
      team: row.team,
      points: row.points,
      sport: row.sport,
    }));
    await syncCollection(table, rows);
    return "stored";
  }

  if (key === "evaluation") {
    await syncSingleton(table, {
      title: store.evaluation.title,
      description: store.evaluation.description,
      opens_at_iso: store.evaluation.opensAtIso,
      closes_at_iso: store.evaluation.closesAtIso,
      questions: store.evaluation.questions,
    });
    return "stored";
  }

  const rows = store.brackets.map((bracket: Bracket) => ({
    id: bracket.id,
    sport: bracket.sport,
    name: bracket.name,
    format: bracket.format,
    teams: bracket.teams,
    rounds: bracket.rounds,
    losers_rounds: bracket.losersRounds ?? null,
    grand_final: bracket.grandFinal ?? null,
    standings: bracket.format === "points" ? (bracket.standings ?? []) : null,
  }));
  await syncCollection(table, rows);
  return "stored";
}

export function changedModules(next: Store, previous: Store | null): ModuleKey[] {
  if (!previous) return ALL_MODULES;
  return ALL_MODULES.filter(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(previous[key]),
  );
}

export type PersistResult = {
  changed: ModuleKey[];
  // False only when Settings was pushed onto a project without the events
  // column, so the UI can tell the admin their catalogue is local-only.
  eventsStoredInCloud: boolean;
};

// Supabase grants writes per module, so untouched modules must not be sent:
// an editor allowed to change News would otherwise be rejected by the Settings
// table even though its payload is identical.
export async function persistStore(
  next: Store,
  previous: Store | null,
): Promise<PersistResult> {
  const changed = changedModules(next, previous);
  const outcomes = await Promise.all(changed.map((key) => writeModule(key, next)));
  return {
    changed,
    eventsStoredInCloud: !outcomes.includes("events-not-stored"),
  };
}
