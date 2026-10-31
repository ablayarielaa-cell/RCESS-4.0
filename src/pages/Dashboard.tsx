import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import type { ComponentType } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const LeafletMapContainer = MapContainer as unknown as ComponentType<any>;
const LeafletTileLayer = TileLayer as unknown as ComponentType<any>;
const LeafletMarker = Marker as unknown as ComponentType<any>;
import {
  Newspaper,
  PhoneCall,
  Copy,
  Trophy,
  MapPinned,
  ClipboardList,
  Settings,
  CalendarCheck,
  ChevronDown,
  LogOut,
  Images,
  Download,
  User,
  KeyRound,
} from "lucide-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import logo from "@/assets/RCESS.png";
import { clearSession, getSession, type Session } from "@/lib/auth";
import {
  loadStore,
  saveStore,
  nanoId,
  buildSingleElimRounds,
  buildDoubleElimExtras,
  scheduleIsVisible,
  scheduleTimeLabel,
  applyCatalogue,
  makeEvent,
  makeCategory,
  eventNamesOf,
  categoryOfEvent,
  payoutsForBrackets,
  leaderboardWithPayouts,
  propagateBracket,
  rankedStandings,
  standingsOf,
  categoryScoreRows,
  categoryView,
  isCategoryView,
  categoryViewLabel,
} from "@/lib/store";
import { fromDateTimeInput, toDateTimeInput } from "@/lib/datetime";
import { fetchStore, persistStore } from "@/lib/storeCloud";
import {
  deleteFeedPost,
  downloadFeedImage,
  feedImageUrl,
  listFeed,
  listFeedByUser,
  postToFeed,
  FEED_PAGE_SIZE,
  MAX_FEED_IMAGES,
  type FeedPost,
} from "@/lib/feed";
import {
  avatarImageUrl,
  changePassword,
  fetchAvatarPath,
  removeAvatar,
  uploadAvatar,
} from "@/lib/profile";
import {
  evaluationWindow,
  fetchEvaluationResults,
  RATING_SCALE,
  submitEvaluation,
  type EvaluationAnswers,
  type EvaluationResults,
} from "@/lib/evaluation";
import type {
  Bracket,
  BracketFormat,
  EvaluationForm,
  EventCategory,
  MapInfo,
  NewsItem,
  NewsType,
  Sport,
  SummitInfo,
  ScoreRow,
  MatchSchedulePost,
  Match,
  Store,
} from "@/lib/store";


const NEWS_PAGE_SIZE = 30;

// How often the portal pulls the latest cloud copy on its own.
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const TOUR_TAB_KEYS = ["news", "feed", "summit", "leaderboard", "bracketing", "schedule", "map", "evaluation", "settings"];

function formatPosted(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function bracketFormatLabel(format: BracketFormat) {
  if (format === "double") return "Double elimination";
  if (format === "points") return "Points ranking";
  return "Single elimination";
}

function scoreViewLabel(view: string) {
  if (view === "Overall") return "Overall score";
  if (isCategoryView(view)) return `${categoryViewLabel(view)} · all events`;
  return `${view} score`;
}

function scheduleWindowBadge(post: MatchSchedulePost, now: Date): string | null {
  const from = post.visibleFromIso ? new Date(post.visibleFromIso) : null;
  const to = post.visibleToIso ? new Date(post.visibleToIso) : null;

  if (!from && !to) return null;
  if (from && now < from) return `Hidden until ${formatPosted(post.visibleFromIso)}`;
  if (to && now > to) return `Hidden since ${formatPosted(post.visibleToIso)}`;
  if (to) return `Hides at ${formatPosted(post.visibleToIso)}`;
  return `Showing since ${formatPosted(post.visibleFromIso)}`;
}

function extractEmergencyPhoneNumbers(item: Partial<SummitInfo>): string[] {
  const values = [item.title, item.subtitle, item.venue, item.dateLabel, item.notes]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const source = values.join("\n");
  const patterns = [
    /\+?63[\s().-]*(?:\(?\d{2,3}\)?[\s().-]*)?\d{3,4}[\s.-]*\d{4}/g,
    /(?:^|[^\d])0(?:[\s().-]*\d){9,10}(?=$|[^\d])/g,
  ];

  const numbers: string[] = [];
  const seen = new Set<string>();
  const collect = (raw: string) => {
    const cleaned = raw.trim().replace(/^[^+0-9]+/, "").replace(/[^0-9]+$/, "");
    const digits = cleaned.replace(/\D/g, "");
    if (!digits || seen.has(digits)) return;
    seen.add(digits);
    numbers.push(cleaned);
  };

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) collect(match[0]);
  }

  for (const line of (item.venue ?? "").split(/[\n,;]+/)) {
    if (/^(?:911|112|117|999)$/.test(line.trim())) collect(line);
  }

  return numbers;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
  }

  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    field.style.pointerEvents = "none";
    document.body.appendChild(field);
    field.focus();
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

function PortalHeader() {
  return (
    <div data-tour-target="welcome" className="flex flex-wrap items-start justify-between gap-4 sm:gap-6">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div className="rcess-logoWrap">
          <img
            src={logo}
            alt="Organization logo"
            className="h-20 w-20 shrink-0 rounded-full bg-white object-contain p-1 sm:h-24 sm:w-24 md:h-30 md:w-30"
          />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] tracking-[0.45em] text-cyan-300/80">PARSU • RCESS</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Regional Civil Engineering Student Summit</div>
          <div className="mt-0.5 text-sm text-white/55">Dashboard</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge className="bg-white/10 text-white border border-white/15 hover:bg-white/10">Live</Badge>
      </div>

    </div>
  );
}

function NewsEditor({
  item,
  onSave,
  onDelete,
}: {
  item?: NewsItem;
  onSave: (next: NewsItem) => void;
  onDelete?: (item: NewsItem) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [type, setType] = useState<NewsType>(item?.type ?? "Announcement");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">TITLE</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-black/30 border-white/15 text-white placeholder:text-white/35"
          placeholder="Announcement title"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">TYPE</label>
        <Select value={type} onValueChange={(v) => setType(v as NewsType)}>
          <SelectTrigger className="bg-black/30 border-white/15 text-white">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Announcement">Announcement</SelectItem>
            <SelectItem value="Update">Update</SelectItem>
            <SelectItem value="Reminder">Reminder</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">BODY</label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-[140px] bg-black/30 border-white/15 text-white placeholder:text-white/35"
          placeholder="Write the announcement details"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        {item && onDelete ? (
          <>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete news
            </Button>
            <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
              <DialogContent className="w-[calc(100%-2rem)] max-w-md border-white/15 bg-[#050820] text-white shadow-2xl">
                <DialogHeader>
                  <DialogTitle>Delete news?</DialogTitle>
                </DialogHeader>
                <p className="text-sm leading-relaxed text-white/70">
                  Are you sure you want to delete “{item.title}”? This action cannot be undone.
                </p>
                <div className="mt-2 flex justify-end gap-3">
                  <Button type="button" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={() => setDeleteConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      setDeleteConfirmOpen(false);
                      onDelete(item);
                    }}
                  >
                    Delete news
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        ) : <span />}
        <Button
          className="bg-cyan-300 text-black hover:bg-cyan-200"
          onClick={() => {
            if (!title.trim()) {
              toast.error("Title is required");
              return;
            }
            onSave({
              id: item?.id ?? nanoId(),
              title: title.trim(),
              body: body.trim(),
              type,
              postedAtIso: item?.postedAtIso ?? new Date().toISOString(),
            });
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function FeedComposer({
  postedBy,
  onPosted,
}: {
  postedBy: string;
  onPosted: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  const previewsRef = useRef<string[]>([]);
  const setAlbumPreviews = (next: string[]) => {
    previewsRef.current = next;
    setPreviews(next);
  };

  useEffect(
    () => () => previewsRef.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );

  function addFiles(incoming: File[]) {
    if (!incoming.length) return;

    const room = MAX_FEED_IMAGES - files.length;
    if (room <= 0) {
      toast.error(`A post holds up to ${MAX_FEED_IMAGES} pictures`);
      return;
    }

    const taken = incoming.slice(0, room);
    if (taken.length < incoming.length) {
      toast.error(`Only ${taken.length} more fit — a post holds up to ${MAX_FEED_IMAGES} pictures`);
    }

    setFiles((list) => [...list, ...taken]);
    setAlbumPreviews([...previewsRef.current, ...taken.map((file) => URL.createObjectURL(file))]);
  }

  function removeFile(index: number) {
    URL.revokeObjectURL(previewsRef.current[index]);
    setFiles((list) => list.filter((_, i) => i !== index));
    setAlbumPreviews(previewsRef.current.filter((_, i) => i !== index));
  }

  function clearFiles() {
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    setFiles([]);
    setAlbumPreviews([]);
  }

  async function handlePost() {
    if (isPosting) return;
    if (files.length === 0 && !caption.trim()) return;

    const count = files.length;
    setIsPosting(true);

    try {
      await postToFeed(files, caption, postedBy);
      clearFiles();
      setCaption("");
      toast.success(count ? `${count} ${count === 1 ? "picture" : "pictures"} posted` : "Caption posted");
      onPosted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post.");
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rcess-scroll min-h-0 flex-1 space-y-4 overflow-y-auto">
        <div className="grid gap-2">
          <label className="text-xs tracking-[0.18em] text-white/60">
            PICTURES (OPTIONAL · UP TO {MAX_FEED_IMAGES})
          </label>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            className="block w-full text-sm text-white file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-300 file:px-4 file:py-2 file:text-black file:hover:bg-cyan-200"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          {files.length > 0 ? (
            <div className="mt-2 text-xs text-white/45">
              {files.length} of {MAX_FEED_IMAGES} {files.length === 1 ? "picture" : "pictures"} selected
              <div className="mt-3 flex flex-wrap content-start gap-3 pr-1">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="w-28">
                    <div className="relative">
                      <img
                        src={previews[index]}
                        alt={file.name}
                        className="h-28 w-28 rounded-xl border border-white/10 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        aria-label={`Remove ${file.name}`}
                        className="absolute right-1 top-1 rounded-md border border-white/20 bg-black/70 px-2 py-0.5 text-[11px] text-white hover:bg-black/90"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-1 truncate" title={file.name}>{file.name}</div>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={clearFiles}
              >
                Clear
              </Button>
            </div>
          ) : (
            <div className="text-xs text-white/40">
              Pick them all at once, or add more in a second pick. Skip this to post a caption on its own. JPG, PNG or WebP, resized before upload.
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <label className="text-xs tracking-[0.18em] text-white/60">CAPTION</label>
          <Textarea
            value={caption}
            rows={3}
            placeholder="Say something about the pictures, or post just this text…"
            className="bg-black/30 border-white/15 text-white placeholder:text-white/35"
            onChange={(event) => setCaption(event.target.value)}
          />
        </div>
      </div>

      <div className="-mx-6 -mb-6 flex shrink-0 justify-end border-t border-white/10 px-6 py-3">
        <Button
          className="bg-cyan-300 text-black hover:bg-cyan-200"
          disabled={(files.length === 0 && !caption.trim()) || isPosting}
          onClick={handlePost}
        >
          {isPosting ? "Posting…" : "Post to feed"}
        </Button>
      </div>
    </div>
  );
}

function FeedDeleteButton({
  post,
  label,
  confirming,
  busy,
  onAsk,
  onCancel,
  onConfirm,
}: {
  post: FeedPost;
  label: string;
  confirming: boolean;
  busy: boolean;
  onAsk: (post: FeedPost) => void;
  onCancel: () => void;
  onConfirm: (post: FeedPost) => void;
}) {
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="border-red-400/40 bg-transparent text-red-200 hover:bg-red-500/15"
        onClick={() => onAsk(post)}
      >
        {label}
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs text-white/55">Delete this post? It cannot be restored.</span>
      <Button
        size="sm"
        variant="outline"
        className="border-white/20 bg-transparent text-white hover:bg-white/10"
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => onConfirm(post)}>
        {busy ? "Deleting…" : "Delete"}
      </Button>
    </span>
  );
}

function EvaluationBuilder({
  form,
  onSave,
}: {
  form: EvaluationForm;
  onSave: (next: EvaluationForm) => void;
}) {
  const [draft, setDraft] = useState<EvaluationForm>(form);

  function setQuestion(id: string, label: string) {
    setDraft((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => (q.id === id ? { ...q, label } : q)),
    }));
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">TITLE</label>
        <Input
          value={draft.title}
          className="bg-black/30 border-white/15 text-white"
          onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">DESCRIPTION (OPTIONAL)</label>
        <Textarea
          value={draft.description}
          rows={2}
          className="bg-black/30 border-white/15 text-white placeholder:text-white/35"
          placeholder="What is being evaluated?"
          onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">QUESTIONS (RATED 1 TO 5)</label>
        {draft.questions.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/50">
            No questions yet. Add the first one below.
          </div>
        ) : (
          draft.questions.map((question, index) => (
            <div key={question.id} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-xs text-white/40">{index + 1}.</span>
              <Input
                value={question.label}
                className="bg-black/30 border-white/15 text-white"
                placeholder="How well was the event organised?"
                onChange={(e) => setQuestion(question.id, e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    questions: prev.questions.filter((q) => q.id !== question.id),
                  }))
                }
              >
                Remove
              </Button>
            </div>
          ))
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-fit border-white/20 bg-transparent text-white hover:bg-white/10"
          onClick={() =>
            setDraft((prev) => ({
              ...prev,
              questions: [...prev.questions, { id: nanoId(), label: "" }],
            }))
          }
        >
          Add question
        </Button>
      </div>

      <div className="flex justify-end">
        <Button
          className="bg-cyan-300 text-black hover:bg-cyan-200"
          onClick={() => {
            const questions = draft.questions.filter((q) => q.label.trim());
            if (!draft.title.trim()) {
              toast.error("Title is required");
              return;
            }
            if (questions.length === 0) {
              toast.error("Add at least one question");
              return;
            }
            onSave({ ...draft, questions });
          }}
        >
          Save form
        </Button>
      </div>
    </div>
  );
}

function ScheduleEditor({ onSave }: { onSave: (p: MatchSchedulePost) => void }) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [timeText, setTimeText] = useState("");
  const [fromLocal, setFromLocal] = useState("");
  const [toLocal, setToLocal] = useState("");

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">TITLE</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-black/30 border-white/15 text-white"
          placeholder="Team A vs Team B"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">LOCATION</label>
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="bg-black/30 border-white/15 text-white"
          placeholder="Main Court"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">TIME</label>
        <Input
          value={timeText}
          onChange={(e) => setTimeText(e.target.value)}
          className="bg-black/30 border-white/15 text-white"
          placeholder="8:00 AM to 12:00 NN, then 1:00 PM to 5:00 PM"
        />
        
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-sm font-medium">When viewers can see it</div>
        <div className="mt-1 text-xs leading-relaxed text-white/45">
          Post every event day now and give each day its own window: Day 1 shows on
          Day 1 and hides when Day 2 starts. Empty means no bound.
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-xs tracking-[0.18em] text-white/60">APPEARS AT</label>
            <Input
              value={fromLocal}
              onChange={(e) => setFromLocal(e.target.value)}
              type="datetime-local"
              className="bg-black/30 border-white/15 text-white"
            />
          </div>
          <div className="grid gap-2">
            <label className="text-xs tracking-[0.18em] text-white/60">DISAPPEARS AT</label>
            <Input
              value={toLocal}
              onChange={(e) => setToLocal(e.target.value)}
              type="datetime-local"
              className="bg-black/30 border-white/15 text-white"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          className="bg-cyan-300 text-black hover:bg-cyan-200"
          onClick={() => {
            if (!title.trim()) {
              toast.error("Title is required");
              return;
            }
            if (!timeText.trim()) {
              toast.error("Time is required");
              return;
            }

            const visibleFromIso = fromDateTimeInput(fromLocal);
            const visibleToIso = fromDateTimeInput(toLocal);

            if (visibleFromIso && visibleToIso && new Date(visibleFromIso) >= new Date(visibleToIso)) {
              toast.error("It has to disappear after it appears");
              return;
            }

            onSave({
              id: nanoId(),
              title: title.trim(),
              location: location.trim(),
              timeText: timeText.trim(),
              postedAtIso: new Date().toISOString(),
              visibleFromIso,
              visibleToIso,
            });
          }}
        >
          Post
        </Button>
      </div>
    </div>
  );
}

function EventsEditor({
  value,
  focusId,
  onSave,
}: {
  value: EventCategory[];
  focusId?: string | null;
  onSave: (events: EventCategory[]) => void;
}) {
  const [categories, setCategories] = useState<EventCategory[]>(() =>
    value.length ? value : [makeCategory("")],
  );
  const [activeId, setActiveId] = useState<string>(() => focusId ?? value[0]?.id ?? "");

  const active = categories.find((category) => category.id === activeId) ?? categories[0] ?? null;

  const addCategory = () => {
    const category = makeCategory("");
    setCategories((current) => [...current, category]);
    setActiveId(category.id);
  };

  const removeCategory = (id: string) => {
    const next = categories.filter((item) => item.id !== id);
    setCategories(next);
    if (id === activeId) setActiveId(next[0]?.id ?? "");
  };

  const patchCategory = (id: string, patch: (category: EventCategory) => EventCategory) =>
    setCategories((current) => current.map((category) => (category.id === id ? patch(category) : category)));

  const numberOrZero = (raw: string) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const movePlacement = (categoryId: string, index: number, delta: number) =>
    patchCategory(categoryId, (category) => {
      const target = index + delta;
      if (target < 0 || target >= category.placements.length) return category;
      const placements = [...category.placements];
      const moved = placements[index];
      placements[index] = placements[target];
      placements[target] = moved;
      return { ...category, placements };
    });

  function save() {
    const clean: EventCategory[] = categories
      .map((category) => ({
        id: category.id,
        name: category.name.trim(),
        placements: category.placements
          .map((placement) => ({ ...placement, label: placement.label.trim() }))
          .filter((placement) => placement.label),
        entryPoints: category.entryPoints,
        noEntryPoints: category.noEntryPoints,
        events: category.events
          .map((event) => ({ id: event.id, name: event.name.trim() }))
          .filter((event) => event.name),
      }))
      .filter((category) => category.name);

    if (!clean.length) {
      toast.error("Add at least one category, for example Sports");
      return;
    }

    const categoryNames = new Set<string>();
    for (const category of clean) {
      const key = category.name.toLowerCase();
      if (categoryNames.has(key)) {
        toast.error(`Two categories are both called ${category.name}`);
        return;
      }
      categoryNames.add(key);
    }

    const eventNames = new Set<string>();
    for (const category of clean) {
      for (const event of category.events) {
        const key = event.name.toLowerCase();
        if (eventNames.has(key)) {
          toast.error(`${event.name} appears in more than one category`);
          return;
        }
        eventNames.add(key);
      }
    }

    onSave(clean);
  }

  const inputClass = "bg-black/30 border-white/15 text-white placeholder:text-white/35";

  return (
    <div className="grid gap-4">
      <div className="text-xs leading-relaxed text-white/45">
        Each category has one award table, and every event in it pays the same points — Basketball and
        Volleyball under Sports share the placements and entry points below. Pick a category to edit its
        points, then add or rename the events that use them.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {categories.map((category) => (
          <Button
            key={category.id}
            size="sm"
            className={
              active && category.id === active.id
                ? "bg-cyan-300 text-black hover:bg-cyan-200"
                : "border border-white/20 bg-transparent text-white hover:bg-white/10"
            }
            onClick={() => setActiveId(category.id)}
          >
            {category.name.trim() || "New category"}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
          onClick={addCategory}
        >
          Add category
        </Button>
      </div>

      {(active ? [active] : []).map((category) => (
        <div key={category.id} className="grid gap-3 rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center gap-2">
            <Input
              value={category.name}
              onChange={(event) =>
                patchCategory(category.id, (current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Category name, e.g. Sports event"
              className={inputClass}
            />
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-white/20 bg-transparent text-white hover:bg-white/10"
              onClick={() => removeCategory(category.id)}
            >
              Remove
            </Button>
          </div>

          <div className="grid gap-2">
            <div className="text-xs tracking-[0.18em] text-white/45">AWARD TABLE</div>
            <div className="text-xs text-white/35">
              Every event in {category.name.trim() || "this category"} pays these points.
            </div>

            {category.placements.map((placement, index) => (
              <div key={placement.id} className="flex flex-wrap items-center gap-2">
                <Input
                  value={placement.label}
                  onChange={(input) =>
                    patchCategory(category.id, (current) => ({
                      ...current,
                      placements: current.placements.map((item) =>
                        item.id === placement.id ? { ...item, label: input.target.value } : item,
                      ),
                    }))
                  }
                  placeholder={index === 0 ? "Champion" : "1st Runner-up"}
                  className={`${inputClass} min-w-[9rem] flex-1`}
                />
                <Input
                  type="number"
                  value={String(placement.points)}
                  onChange={(input) =>
                    patchCategory(category.id, (current) => ({
                      ...current,
                      placements: current.placements.map((item) =>
                        item.id === placement.id
                          ? { ...item, points: numberOrZero(input.target.value) }
                          : item,
                      ),
                    }))
                  }
                  className={`${inputClass} w-20`}
                  title="Points"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                  onClick={() => movePlacement(category.id, index, -1)}
                  disabled={index === 0}
                  title="Move up"
                >
                  Up
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                  onClick={() => movePlacement(category.id, index, 1)}
                  disabled={index === category.placements.length - 1}
                  title="Move down"
                >
                  Down
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                  onClick={() =>
                    patchCategory(category.id, (current) => ({
                      ...current,
                      placements: current.placements.filter((item) => item.id !== placement.id),
                    }))
                  }
                >
                  Delete
                </Button>
              </div>
            ))}

            <Button
              size="sm"
              variant="outline"
              className="w-fit border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
              onClick={() =>
                patchCategory(category.id, (current) => ({
                  ...current,
                  placements: [...current.placements, { id: nanoId(), label: "", points: 0 }],
                }))
              }
            >
              Add placement
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs tracking-[0.18em] text-white/45">WITH ENTRY</label>
              <Input
                type="number"
                value={String(category.entryPoints)}
                onChange={(input) =>
                  patchCategory(category.id, (current) => ({
                    ...current,
                    entryPoints: numberOrZero(input.target.value),
                  }))
                }
                className={inputClass}
              />
              <div className="text-xs text-white/35">
                For every team that played without placing; medallists get their award only.
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-xs tracking-[0.18em] text-white/45">WITHOUT ENTRY</label>
              <Input
                type="number"
                value={String(category.noEntryPoints)}
                onChange={(input) =>
                  patchCategory(category.id, (current) => ({
                    ...current,
                    noEntryPoints: numberOrZero(input.target.value),
                  }))
                }
                className={inputClass}
              />
              <div className="text-xs text-white/35">For a team registered for an event but absent.</div>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-xs tracking-[0.18em] text-white/45">EVENTS</div>
            {category.events.map((event) => (
              <div key={event.id} className="flex items-center gap-2">
                <Input
                  value={event.name}
                  onChange={(input) =>
                    patchCategory(category.id, (current) => ({
                      ...current,
                      events: current.events.map((item) =>
                        item.id === event.id ? { ...item, name: input.target.value } : item,
                      ),
                    }))
                  }
                  placeholder="Event name, e.g. Basketball"
                  className={inputClass}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-white/20 bg-transparent text-white hover:bg-white/10"
                  onClick={() =>
                    patchCategory(category.id, (current) => ({
                      ...current,
                      events: current.events.filter((item) => item.id !== event.id),
                    }))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="w-fit border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
              onClick={() =>
                patchCategory(category.id, (current) => ({
                  ...current,
                  events: [...current.events, makeEvent("")],
                }))
              }
            >
              Add event
            </Button>
          </div>
        </div>
      ))}

      <div className="flex justify-end gap-2">
        <Button
          className="bg-cyan-300 text-black hover:bg-cyan-200"
          onClick={save}
        >
          Save events
        </Button>
      </div>
    </div>
  );
}

function SummitEditor({ value, onSave, onDelete }: { value: SummitInfo; onSave: (v: SummitInfo) => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState<SummitInfo>(value);
  const [numbers, setNumbers] = useState<string[]>(() => {
    const found = extractEmergencyPhoneNumbers(value);
    return found.length ? found : [""];
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const save = () =>
    onSave({
      ...draft,
      venue: numbers.map((number) => number.trim()).filter(Boolean).join("\n"),
    });
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">HOTLINE / SERVICE NAME</label>
        <Input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="bg-black/30 border-white/15 text-white"
        />
      </div>
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">DEPARTMENT / AGENCY</label>
        <Input
          value={draft.subtitle}
          onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
          className="bg-black/30 border-white/15 text-white"
        />
      </div>
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">CONTACT NUMBERS</label>
        <div className="grid gap-2">
          {numbers.map((number, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={number}
                onChange={(e) =>
                  setNumbers((list) => list.map((entry, i) => (i === index ? e.target.value : entry)))
                }
                className="bg-black/30 border-white/15 text-white"
                placeholder={`Contact number ${index + 1}`}
              />
              {numbers.length > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-white/20 bg-transparent text-white hover:bg-white/10"
                  onClick={() => setNumbers((list) => list.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-cyan-300/25 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
            onClick={() => setNumbers((list) => [...list, ""])}
          >
            Add another number
          </Button>
          <span className="text-xs text-white/40">Each number gets its own tap-to-call line.</span>
        </div>
      </div>
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">AVAILABILITY / HOURS</label>
        <Input
          value={draft.dateLabel}
          onChange={(e) => setDraft({ ...draft, dateLabel: e.target.value })}
          className="bg-black/30 border-white/15 text-white"
        />
      </div>
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">INSTRUCTIONS / NOTES</label>
        <Textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className="min-h-[120px] bg-black/30 border-white/15 text-white"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {onDelete ? (
          <>
            <Button type="button" variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
              Delete hotline contact
            </Button>
            <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
              <DialogContent className="w-[calc(100%-2rem)] max-w-md border-white/15 bg-[#050820] text-white shadow-2xl">
                <DialogHeader>
                  <DialogTitle>Delete hotline contact?</DialogTitle>
                </DialogHeader>
                <p className="text-sm leading-relaxed text-white/70">
                  Are you sure you want to delete “{draft.title || "Emergency Hotline"}”? This action cannot be undone.
                </p>
                <div className="mt-2 flex justify-end gap-3">
                  <Button type="button" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={() => setDeleteConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => {
                    setDeleteConfirmOpen(false);
                    onDelete();
                  }}>
                    Delete hotline contact
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        ) : <span />}
        <Button
          className="bg-cyan-300 text-black hover:bg-cyan-200"
          onClick={() => {
            if (!draft.title.trim()) {
              toast.error("Hotline / service name is required");
              return;
            }
            if (!numbers.some((number) => number.trim())) {
              toast.error("Enter at least one contact number");
              return;
            }
            save();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

type MapLocation = {
  id: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
};
type MultiMapInfo = MapInfo & { locations?: MapLocation[] };

const NEW_LOCATION_ID = "__new";

const mapPinIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const mapFocusPinIcon = new L.DivIcon({
  className: "",
  html: '<span style="display:block;width:20px;height:20px;border-radius:9999px;background:#67e8f9;border:2px solid #050820;box-shadow:0 0 0 6px rgba(103,232,249,.25),0 0 20px 8px rgba(103,232,249,.45)"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
});

function FitLocations({ locations }: { locations: MapLocation[] }) {
  const map = useMap();
  useEffect(() => {
    const valid = locations.filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng));
    if (valid.length === 1) {
      map.setView([valid[0].lat!, valid[0].lng!], 14);
    } else if (valid.length > 1) {
      map.fitBounds(valid.map((location) => [location.lat!, location.lng!] as [number, number]), { padding: [30, 30], maxZoom: 14 });
    }
  }, [locations, map]);
  return null;
}

function schedulePinFor(locations: MapLocation[], place: string): MapLocation | null {
  const needle = place.trim().toLowerCase();
  if (!needle) return null;

  const score = (location: MapLocation) => {
    const name = (location.name ?? "").trim().toLowerCase();
    const address = (location.address ?? "").trim().toLowerCase();
    if (name && name === needle) return 4;
    if (name && (name.includes(needle) || needle.includes(name))) return 3;
    if (address && (address.includes(needle) || needle.includes(address))) return 2;
    return 0;
  };

  let best: MapLocation | null = null;
  let bestScore = 0;
  for (const location of locations) {
    const current = score(location);
    if (current > bestScore) {
      best = location;
      bestScore = current;
    }
  }
  return best;
}

function MapFocus({ location }: { location: MapLocation }) {
  const map = useMap();
  const lat = location.lat;
  const lng = location.lng;

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    map.invalidateSize();
    map.setView([lat!, lng!], 16);
  }, [lat, lng, map]);

  return null;
}

function MultiLocationMap({ locations, focus }: { locations: MapLocation[]; focus?: MapLocation | null }) {
  const valid = locations.filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng));
  if (!valid.length) return null;
  const center: [number, number] = [
    valid.reduce((sum, location) => sum + location.lat!, 0) / valid.length,
    valid.reduce((sum, location) => sum + location.lng!, 0) / valid.length,
  ];
  const focused = focus && valid.some((location) => location.id === focus.id) ? focus : null;
  return (
    <LeafletMapContainer center={center} zoom={12} scrollWheelZoom className="h-[300px] sm:h-[420px] w-full z-0">
      <LeafletTileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitLocations locations={valid} />
      {focused ? <MapFocus location={focused} /> : null}
      {valid.map((location, index) => (
        <LeafletMarker
          key={location.id}
          position={[location.lat!, location.lng!]}
          icon={location.id === focused?.id ? mapFocusPinIcon : mapPinIcon}
          zIndexOffset={location.id === focused?.id ? 1000 : 0}
        >
          <Popup>
            <div style={{ minWidth: 150 }}>
              <strong>{index + 1}. {location.name || "Location"}</strong>
              <div>{location.address}</div>
            </div>
          </Popup>
        </LeafletMarker>
      ))}
    </LeafletMapContainer>
  );
}

function MapEditor({
  value,
  focusId,
  onSave,
}: {
  value: MapInfo;
  focusId?: string | null;
  onSave: (v: MapInfo) => void;
}) {
  const existing = ((value as MultiMapInfo).locations ?? []) as MapLocation[];
  const original = focusId && focusId !== NEW_LOCATION_ID
    ? existing.find((location) => location.id === focusId) ?? null
    : null;
  const [location, setLocation] = useState<MapLocation>(() => original ?? { id: nanoId(), name: "", address: "" });
  const [notes, setNotes] = useState(value.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const update = (changes: Partial<MapLocation>) => setLocation((current) => ({ ...current, ...changes }));

  const saveLocation = async () => {
    setSaveError("");
    const name = location.name.trim();
    const address = location.address.trim();
    if (!name || !address) {
      setSaveError("Enter both a location name and a full address.");
      return;
    }
    setIsSaving(true);
    try {
      let resolved: MapLocation = { ...location, name, address };
      if (!(Number.isFinite(location.lat) && Number.isFinite(location.lng))) {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Could not find coordinates for "${name}". Check the address and try again.`);
        const results = await response.json();
        if (!Array.isArray(results) || !results[0]) {
          throw new Error(`Could not find "${address}". Try a more complete address, including city or province.`);
        }
        resolved = { ...resolved, lat: Number(results[0].lat), lng: Number(results[0].lon) };
      }
      const locations = original
        ? existing.map((item) => (item.id === original.id ? resolved : item))
        : [...existing, resolved];
      onSave({ ...value, notes, locations });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this location. Please check the address and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="text-xs text-white/50">
        {original
          ? `Change the details of ${original.name.trim() || "this location"} and save it again.`
          : "Name the place, paste its full address, and save. The address is turned into map coordinates."}
      </div>
      <div className="grid gap-2">
        <label className="text-xs text-white/60">LOCATION NAME</label>
        <Input value={location.name} onChange={(event) => update({ name: event.target.value })} placeholder="e.g. Main Gymnasium" className="border-white/15 bg-black/30 text-white" />
      </div>
      <div className="grid gap-2">
        <label className="text-xs text-white/60">FULL ADDRESS</label>
        <Input value={location.address} onChange={(event) => update({ address: event.target.value, lat: undefined, lng: undefined })} placeholder="Street, barangay, city, province" className="border-white/15 bg-black/30 text-white" />
      </div>
      {Number.isFinite(location.lat) && Number.isFinite(location.lng) ? <div className="text-xs text-emerald-200/70">Coordinates found: {location.lat!.toFixed(5)}, {location.lng!.toFixed(5)}</div> : null}

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">MAP NOTES (OPTIONAL)</label>
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-[80px] border-white/15 bg-black/30 text-white" placeholder="Directions or general map information" />
      </div>
      {saveError ? <div role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{saveError}</div> : null}
      <div className="flex justify-end">
        <Button className="bg-cyan-300 text-black hover:bg-cyan-200" onClick={saveLocation} disabled={isSaving}>
          {isSaving ? "Finding location…" : original ? "Save changes" : "Add location"}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-white/40">Addresses are converted to map coordinates using OpenStreetMap's public geocoding service. For frequent/high-volume use, configure a dedicated geocoding provider.</p>
    </div>
  );
}

function BracketEditor({
  value,
  categories,
  onSave,
}: {
  value?: Bracket;
  categories: EventCategory[];
  onSave: (b: Bracket) => void;
}) {
  const eventNames = eventNamesOf(categories);
  const [sport, setSport] = useState<Sport>(value?.sport ?? eventNames[0] ?? "");
  const [format, setFormat] = useState<BracketFormat>(value?.format ?? "single");
  const [name, setName] = useState(value?.name ?? "");
  const [teamsText, setTeamsText] = useState(
    (value?.teams ?? []).join("\n") || "Team A\nTeam B"
  );
  const chosen = categoryOfEvent(categories, sport);
  const isPoints = format === "points";

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">EVENT</label>
        {eventNames.length ? (
          <Select value={sport} onValueChange={(v) => setSport(v as Sport)}>
            <SelectTrigger className="bg-black/30 border-white/15 text-white">
              <SelectValue placeholder="Select event" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {categories.map((category) =>
                category.events.length ? (
                  <SelectGroup key={category.id}>
                    <SelectLabel>{category.name}</SelectLabel>
                    {category.events.map((event) => (
                      <SelectItem key={event.id} value={event.name}>
                        {event.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null,
              )}
            </SelectContent>
          </Select>
        ) : (
          <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/45">
            No events defined yet. Add them in Settings first.
          </div>
        )}
        {chosen?.placements.length ? (
          <div className="text-xs leading-relaxed text-white/40">
            {chosen.placements.map((placement) => `${placement.label}: ${placement.points}`).join(" • ")}
            {` • Entry: ${chosen.entryPoints}`}
            {" — the bracket pays these out to the Leaderboard."}
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">FORMAT</label>
        <Select value={format} onValueChange={(v) => setFormat(v as any)}>
          <SelectTrigger className="bg-black/30 border-white/15 text-white">
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Single elimination</SelectItem>
            <SelectItem value="double">Double elimination</SelectItem>
            <SelectItem value="points">Points ranking (no bracket)</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-white/35">
          {isPoints
            ? "For events like quiz bee that are decided by points instead of matchups. The ranking sorts itself highest first and pays the category's award tiers."
            : "Double elimination drops losers into a second bracket; the winners-bracket champion then meets the last team standing there in the grand final."}
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">BRACKET NAME</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-black/30 border-white/15 text-white"
          placeholder="e.g., Men's Division"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-xs tracking-[0.18em] text-white/60">
          {isPoints ? "PARTICIPANTS (ONE PER LINE)" : "TEAMS (ONE PER LINE)"}
        </label>
        <Textarea
          value={teamsText}
          onChange={(e) => setTeamsText(e.target.value)}
          className="min-h-[140px] bg-black/30 border-white/15 text-white"
        />
      </div>

      <div className="flex justify-end">
        <Button
          className="bg-cyan-300 text-black hover:bg-cyan-200"
          onClick={() => {
            const teams = teamsText
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean);
            if (!sport) {
              toast.error("Add the events in Settings before creating a bracket");
              return;
            }
            if (!name.trim()) {
              toast.error("Bracket name is required");
              return;
            }
            if (teams.length < 2) {
              toast.error(isPoints ? "Add at least 2 participants" : "Add at least 2 teams");
              return;
            }

            if (isPoints) {
              // Scores already typed for a participant survive a rename of the
              // bracket and drop away with participants that were removed.
              const recorded = new Map(
                (value?.standings ?? []).map((row) => [row.team, row.points]),
              );

              onSave({
                id: value?.id ?? nanoId(),
                sport,
                name: name.trim(),
                format,
                teams,
                rounds: [],
                standings: teams.map((team) => ({
                  team,
                  points: recorded.get(team) ?? 0,
                })),
              });
              return;
            }

            const rounds = buildSingleElimRounds(teams);
            const extras = format === "double" ? buildDoubleElimExtras(teams) : null;
            const bracket: Bracket = {
              id: value?.id ?? nanoId(),
              sport,
              name: name.trim(),
              format,
              teams,
              rounds,
              ...(extras ? { losersRounds: extras.losersRounds, grandFinal: extras.grandFinal } : {}),
            };
            // Byes are decided as soon as the draw exists, so the losers bracket
            // starts out already reflecting them.
            onSave(format === "double" ? propagateBracket(bracket, "auto") : bracket);
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}



type BracketSection = "winners" | "losers" | "grandFinal";

function bracketMatchAt(
  bracket: Bracket,
  section: BracketSection,
  roundIndex: number,
  matchIndex: number,
): Match | undefined {
  if (section === "grandFinal") return bracket.grandFinal;
  const rounds = section === "losers" ? bracket.losersRounds : bracket.rounds;
  return rounds?.[roundIndex]?.matches[matchIndex];
}

function BracketMatchCard({
  match,
  canEdit,
  autoAdvance,
  caption,
  onScore,
  onAdvance,
}: {
  match: Match;
  canEdit: boolean;
  autoAdvance: boolean;
  caption?: string;
  onScore: (side: "a" | "b", rawValue: string) => void;
  onAdvance: (side: "a" | "b") => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="grid gap-2">
        {(["a", "b"] as const).map((sideKey) => {
          const side = match[sideKey];
          const isWinner = match.winner === sideKey;

          return (
            <div
              key={sideKey}
              className={`flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 ${
                isWinner ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-black/25"
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm">
                  {side.team ?? <span className="text-white/35">TBD</span>}
                </div>
              </div>

              <Input
                type="number"
                min={0}
                step={1}
                value={side.score ?? ""}
                onChange={(e) => onScore(sideKey, e.target.value)}
                disabled={!canEdit || !side.team}
                inputMode="numeric"
                className="w-20 bg-black/30 border-white/15 text-white disabled:opacity-60"
                placeholder="-"
              />
            </div>
          );
        })}

        {!autoAdvance ? (
          <div className="mt-1 flex items-center gap-2">
            {(["a", "b"] as const).map((sideKey) => (
              <Button
                key={sideKey}
                size="sm"
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                disabled={!canEdit || !match.a.team || !match.b.team}
                title={!canEdit ? "No permission" : undefined}
                onClick={() => onAdvance(sideKey)}
              >
                Advance {sideKey.toUpperCase()}
              </Button>
            ))}
          </div>
        ) : null}

        {caption ? <div className="text-[11px] text-white/35">{caption}</div> : null}
      </div>
    </div>
  );
}

function BracketRoundColumns({
  rounds,
  section,
  bracket,
  canEdit,
  autoAdvance,
  onScore,
  onAdvance,
}: {
  rounds: { name: string; matches: Match[] }[];
  section: BracketSection;
  bracket: Bracket;
  canEdit: boolean;
  autoAdvance: boolean;
  onScore: (
    bracket: Bracket,
    section: BracketSection,
    roundIndex: number,
    matchIndex: number,
    side: "a" | "b",
    rawValue: string,
  ) => void;
  onAdvance: (
    bracket: Bracket,
    section: BracketSection,
    roundIndex: number,
    matchIndex: number,
    side: "a" | "b",
  ) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="flex w-max min-w-full items-start gap-4">
        {rounds.map((round, roundIndex) => (
          <div
            key={roundIndex}
            className="w-[280px] shrink-0 rounded-xl border border-white/10 bg-black/25 p-3"
          >
            <div className="text-xs tracking-[0.25em] text-white/55">
              {round.name.toUpperCase()}
            </div>

            <div className="mt-3 grid gap-3">
              {round.matches.map((match, matchIndex) => (
                <BracketMatchCard
                  key={match.id}
                  match={match}
                  canEdit={canEdit}
                  autoAdvance={autoAdvance}
                  caption={section === "winners" && roundIndex === 0 ? `Match ${matchIndex + 1}` : undefined}
                  onScore={(side, rawValue) =>
                    onScore(bracket, section, roundIndex, matchIndex, side, rawValue)
                  }
                  onAdvance={(side) =>
                    onAdvance(bracket, section, roundIndex, matchIndex, side)
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PointsRanking({
  bracket,
  category,
  canEdit,
  onPoints,
}: {
  bracket: Bracket;
  category: EventCategory | null;
  canEdit: boolean;
  onPoints: (team: string, rawValue: string) => void;
}) {
  const ranked = rankedStandings(bracket, category);
  const decided = ranked.some((row) => row.points > 0);

  return (
    <div className="mt-4">
      <div className="text-xs tracking-[0.25em] text-white/55">POINTS RANKING</div>

      <div className="mt-2 grid gap-2">
        {ranked.map((row) => (
          <div
            key={row.team}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
          >
            <div className="w-8 shrink-0 text-sm font-semibold text-white/60">#{row.rank}</div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{row.team}</div>
              {row.label ? (
                <div className="text-[11px] text-cyan-200/70">
                  {row.label} · {row.awardPoints} pts
                </div>
              ) : null}
            </div>

            <Input
              type="number"
              step={1}
              defaultValue={row.points}
              disabled={!canEdit}
              aria-label={`${row.team} points`}
              title={!canEdit ? "No permission" : undefined}
              onBlur={(event) => onPoints(row.team, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              className="w-24 border-white/15 bg-black/30 text-right text-white disabled:opacity-60"
            />
          </div>
        ))}
      </div>

      <div className="mt-2 text-xs text-white/35">
        {decided
          ? "Sorted by points, highest first. Ties share a place and the category's award tier."
          : "Enter points to decide the ranking. Nothing is paid to the Leaderboard until someone scores."}
      </div>
    </div>
  );
}

function describeSyncError(error: unknown): string {
  const message =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? (error as { message: string }).message
      : "";

  if (/fetch|network|offline/i.test(message)) {
    return "Could not reach Supabase. Check your connection.";
  }

  return message || "Could not reach Supabase.";
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [session, setSession] = useState<Session>(() => getSession());
  const isAdmin = session.role === "admin";
  const isViewer = session.role === "viewer";
  const isGuest = session.role === "guest";
  const role = session.role;
  const isReadOnly = isViewer || isGuest;

  const [store, setStore] = useState<Store>(() => loadStore());
  const cloudBaselineRef = useRef<Store | null>(null);
  const pendingPushRef = useRef<Store | null>(null);
  const isPushingRef = useRef(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pullError, setPullError] = useState("");
  const [pushError, setPushError] = useState("");
  const [eventsLocalOnly, setEventsLocalOnly] = useState(false);
  const [isEventsEditorOpen, setEventsEditorOpen] = useState(false);
  const [eventsEditorFocus, setEventsEditorFocus] = useState<string | null>(null);
  const [isMapEditorOpen, setMapEditorOpen] = useState(false);
  const [mapEditorFocus, setMapEditorFocus] = useState<string | null>(null);
  const [isMapManagerOpen, setMapManagerOpen] = useState(false);
  const [bracketSportFilter, setBracketSportFilter] = useState<"ALL" | string>("ALL");
  const [bracketCategoryFilter, setBracketCategoryFilter] = useState<"ALL" | string>("ALL");
  const [isNewBracketOpen, setNewBracketOpen] = useState(false);
  const [bracketToEdit, setBracketToEdit] = useState<string | null>(null);
  const [isPayoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [scheduleNow, setScheduleNow] = useState(() => Date.now());
  const [leaderboardSportFilter, setLeaderboardSportFilter] = useState<"Overall" | string>("Overall");
  const [tab, setTab] = useState<string>("news");
  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [feedError, setFeedError] = useState("");
  const [isFeedLoading, setIsFeedLoading] = useState(false);
  const [feedReloadTick, setFeedReloadTick] = useState(0);
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE_SIZE);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [openFeedPost, setOpenFeedPost] = useState<FeedPost | null>(null);
  const [downloadFeedPost, setDownloadFeedPost] = useState<FeedPost | null>(null);
  const [downloadingFeedPath, setDownloadingFeedPath] = useState<string | null>(null);
  const [feedConfirmId, setFeedConfirmId] = useState<string | null>(null);
  const [isFeedDeleting, setIsFeedDeleting] = useState(false);
  const [newsLimit, setNewsLimit] = useState(NEWS_PAGE_SIZE);
  const [schedulePlace, setSchedulePlace] = useState<{ id: string; title: string; place: string } | null>(null);
  const [geocodedPlace, setGeocodedPlace] = useState<MapLocation | null>(null);
  const [mapPlaceNotice, setMapPlaceNotice] = useState("");
  const [avatarPath, setAvatarPath] = useState("");
  const [avatarStamp, setAvatarStamp] = useState(0);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const [myPosts, setMyPosts] = useState<FeedPost[]>([]);
  const [myPostsTotal, setMyPostsTotal] = useState(0);
  const [myPostsLimit, setMyPostsLimit] = useState(FEED_PAGE_SIZE);
  const [myPostsError, setMyPostsError] = useState("");
  const [isMyPostsLoading, setIsMyPostsLoading] = useState(false);
  const [myPostsTick, setMyPostsTick] = useState(0);
  const [isProfileComposerOpen, setProfileComposerOpen] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  async function handleFeedDelete(post: FeedPost) {
    setIsFeedDeleting(true);
    try {
      await deleteFeedPost(post);
      setFeed((prev) => prev.filter((p) => p.id !== post.id));
      if (session.username && post.postedBy === session.username) {
        setMyPosts((prev) => prev.filter((p) => p.id !== post.id));
        setMyPostsTotal((total) => Math.max(0, total - 1));
      }
      setOpenFeedPost((prev) => (prev && prev.id === post.id ? null : prev));
      setFeedConfirmId(null);
      toast.success("Post deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the post.");
    } finally {
      setIsFeedDeleting(false);
    }
  }

  async function handleFeedDownload(post: FeedPost, path: string) {
    setDownloadingFeedPath(path);
    try {
      await downloadFeedImage(post, path);
      toast.success("Picture downloaded");
    } catch {
      toast.error("Could not download that picture.");
    } finally {
      setDownloadingFeedPath(null);
    }
  }

  async function handleAvatarPick(file: File | undefined) {
    if (!file || !session.username) return;

    setIsAvatarBusy(true);
    try {
      const path = await uploadAvatar(file, session.username);
      setAvatarPath(path);
      setAvatarStamp(Date.now());
      toast.success("Profile picture updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload that picture.");
    } finally {
      setIsAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    if (!session.username) return;

    setIsAvatarBusy(true);
    try {
      await removeAvatar(session.username);
      setAvatarPath("");
      toast.success("Profile picture removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the picture.");
    } finally {
      setIsAvatarBusy(false);
    }
  }

  async function handleChangePassword() {
    if (!session.username || isChangingPassword) return;

    if (!passwordForm.current) {
      toast.error("Enter your current password first.");
      return;
    }

    if (passwordForm.next.length < 6) {
      toast.error("The new password needs at least 6 characters.");
      return;
    }

    if (passwordForm.next !== passwordForm.confirm) {
      toast.error("The new passwords do not match.");
      return;
    }

    setIsChangingPassword(true);
    try {
      await changePassword(session.username, passwordForm.current, passwordForm.next);
      setPasswordForm({ current: "", next: "", confirm: "" });
      toast.success("Password changed. Use the new one next time you sign in.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the password.");
    } finally {
      setIsChangingPassword(false);
    }
  }
  const [isFormBuilderOpen, setIsFormBuilderOpen] = useState(false);
  const [evalResults, setEvalResults] = useState<EvaluationResults | null>(null);
  const [evalError, setEvalError] = useState("");
  const [isEvalLoading, setIsEvalLoading] = useState(false);
  const [evalReloadTick, setEvalReloadTick] = useState(0);
  const [evalAnswers, setEvalAnswers] = useState<EvaluationAnswers>({});
  const [evalComment, setEvalComment] = useState("");
  const [isEvalSubmitting, setIsEvalSubmitting] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [viewerTutorialEnabled, setViewerTutorialEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("rcess-viewer-tour-enabled") !== "false";
    } catch {
      return true;
    }
  });
  const [viewerTourOpen, setViewerTourOpen] = useState(false);
  const [viewerTourStep, setViewerTourStep] = useState(0);
  const [viewerTourRect, setViewerTourRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    tipTop: number;
    tipLeft: number;
  } | null>(null);

  const viewerTourSteps = useMemo(() => {
    const steps = [
      { target: "navigation", tab: "news", title: "Portal Navigation", description: "Use the navigation to move through News, Emergency Hotline, Leaderboard, Bracketing, Schedule, Map, Evaluation, and Settings." },
      { target: "news", tab: "news", title: "News and Announcements", description: "Read the latest announcements, updates, and reminders here." },
      { target: "feed", tab: "feed", title: "News Feed", description: "The feed is where the event is shared as it happens." },
      { target: "feed-add", tab: "feed", title: "Posting to the feed", description: "Select Add post. One post can carry up to 10 pictures: pick them all at once, or add more in a second pick and remove any you change your mind about. A caption on its own is allowed too." },
      { target: "summit", tab: "summit", title: "Emergency Hotline", description: "Find emergency service contacts here. Tap a phone number to call it when your device supports phone links. Scroll down if there are multiple hotline contacts." },
      { target: "leaderboard", tab: "leaderboard", title: "Leaderboard", description: "Check team standings and points. Use the score-view dropdown to switch between the overall scoreboard, each category's total, and each event." },
      { target: "bracketing", tab: "bracketing", title: "Bracketing", description: "Follow the tournament bracket and see how teams progress through the rounds." },
      { target: "schedule", tab: "schedule", title: "Schedule", description: "Review the schedule for the current event day." },
      { target: "map", tab: "map", title: "Map", description: "View the venue or location information provided by the organizers." },
      { target: "evaluation", tab: "evaluation", title: "Evaluation", description: "This section is reserved for evaluating the whole RCESS event." },
    ];

    if (isAdmin) {
      steps.push({ target: "settings", tab: "settings", title: "Settings", description: "Settings is the administrator view. Set the countdown date, choose which roles may edit each section, and turn this guide on or off for everyone. Changes only reach other devices after you press Save settings." });
    }

    if (role !== "guest") {
      steps.push({ target: "profile", tab: "profile", title: "Account · Profile", description: "Profile where you can view your posted news feeds or upload a new post." });
      steps.push({ target: "password", tab: "password", title: "Account · Change password", description: "Change password is separate from Profile. Enter the password you were given first, then the new one twice — at least 6 characters. Your next sign-in uses the new password, so make a note of it." });
    }

    return steps;
  }, [isAdmin, role]);

  const mobileTutorialMenuMustStayOpen =
    viewerTourOpen &&
    viewerTourStep > 0 &&
    typeof window !== "undefined" &&
    window.innerWidth < 1024;

  const canEditSettings = store.settings.permissions.settingsEditors.includes(role);
  const canEditNews = store.settings.permissions.newsEditors.includes(role);
  const canEditSummit = store.settings.permissions.summitEditors.includes(role);
  const canEditLeaderboard = store.settings.permissions.leaderboardEditors.includes(role);
  const canEditBrackets = store.settings.permissions.bracketEditors.includes(role);
  const canEditSchedule = store.settings.permissions.scheduleEditors.includes(role);
  const canEditMap = store.settings.permissions.mapEditors.includes(role);
  const bracketAutoAdvance = store.settings.bracketAutoAdvance;

  const navItems = useMemo(() => {
    const base = [
      { k: "news", t: "News" },
      { k: "feed", t: "News Feed" },
      { k: "summit", t: "Emergency Hotline" },
      { k: "leaderboard", t: "Leaderboard" },
      { k: "bracketing", t: "Bracketing" },
      { k: "schedule", t: "Schedule" },
      { k: "map", t: "Map" },
      { k: "evaluation", t: "Evaluation" },
    ];
    if (isAdmin) base.push({ k: "settings", t: "Settings" });
    if (role === "guest") return base.filter((i) => i.k === "news" || i.k === "leaderboard");
    return base;
  }, [isAdmin, role]);

  const desktopTabs = useMemo(() => {
    const base = [
      { k: "news", t: "News", icon: Newspaper },
      { k: "feed", t: "News Feed", icon: Images },
      { k: "summit", t: "Emergency Hotline", icon: PhoneCall },
      { k: "leaderboard", t: "Leaderboard", icon: Trophy },
      { k: "bracketing", t: "Bracketing", icon: Trophy },
      { k: "schedule", t: "Schedule", icon: CalendarCheck },
      { k: "map", t: "Map", icon: MapPinned },
      { k: "evaluation", t: "Evaluation", icon: ClipboardList },
      ...(isAdmin ? [{ k: "settings", t: "Settings", icon: Settings }] : []),
    ] as Array<{ k: string; t: string; icon: any }>;

    if (role === "guest") return base.filter((i) => i.k === "news" || i.k === "leaderboard");
    return base;
  }, [isAdmin, role]);

  useEffect(() => {
    let cancelled = false;

    fetchStore()
      .then((cloud) => {
        if (cancelled) return;
        cloudBaselineRef.current = cloud;
        setStore(cloud);
        saveStore(cloud);
        setPullError("");
      })
      .catch((error) => {
        if (!cancelled) setPullError(describeSyncError(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Every five minutes the portal pulls the latest cloud copy so viewers see
  // other people's edits without a manual reload. A tick is skipped while the
  // admin is typing, a dialog is open, or a write is still on its way up, so
  // the refresh never overwrites work in progress.
  useEffect(() => {
    let lastRefresh = Date.now();

    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (isPushingRef.current || pendingPushRef.current) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;

      const active = document.activeElement as HTMLElement | null;
      const typing =
        active?.tagName === "INPUT" ||
        active?.tagName === "TEXTAREA" ||
        Boolean(active?.isContentEditable);
      if (typing) return;

      lastRefresh = Date.now();

      fetchStore()
        .then((cloud) => {
          cloudBaselineRef.current = cloud;
          setStore(cloud);
          saveStore(cloud);
          setPullError("");
        })
        .catch(() => {
          // Keep the last good copy on screen; the next tick retries.
        });

      setFeedReloadTick((tick) => tick + 1);
      setMyPostsTick((tick) => tick + 1);
    };

    const interval = window.setInterval(refresh, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (Date.now() - lastRefresh >= AUTO_REFRESH_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (tab !== "feed" || isGuest) return;

    let cancelled = false;
    setIsFeedLoading(true);

    listFeed(feedLimit)
      .then((rows) => {
        if (cancelled) return;
        setFeed(rows);
        setFeedError("");
      })
      .catch((error) => {
        if (cancelled) return;
        setFeedError(describeSyncError(error));
      })
      .finally(() => {
        if (!cancelled) setIsFeedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [feedReloadTick, feedLimit, tab, isGuest]);

  useEffect(() => {
    if (tab !== "profile" || isGuest || !session.username) return;

    let cancelled = false;

    fetchAvatarPath(session.username)
      .then((path) => {
        if (cancelled) return;
        setAvatarPath(path);
        setAvatarStamp(Date.now());
        setProfileError("");
      })
      .catch((error) => {
        if (!cancelled) setProfileError(describeSyncError(error));
      });

    return () => {
      cancelled = true;
    };
  }, [isGuest, session.username, tab]);

  useEffect(() => {
    if (tab !== "profile" || isGuest || !session.username) return;

    let cancelled = false;
    setIsMyPostsLoading(true);

    listFeedByUser(session.username, myPostsLimit)
      .then(({ posts, total }) => {
        if (cancelled) return;
        setMyPosts(posts);
        setMyPostsTotal(total);
        setMyPostsError("");
      })
      .catch((error) => {
        if (cancelled) return;
        setMyPostsError(describeSyncError(error));
      })
      .finally(() => {
        if (!cancelled) setIsMyPostsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isGuest, myPostsLimit, myPostsTick, session.username, tab]);

  useEffect(() => {
    if (tab !== "evaluation" || isGuest) return;

    let cancelled = false;
    setIsEvalLoading(true);

    fetchEvaluationResults(store.evaluation)
      .then((results) => {
        if (cancelled) return;
        setEvalResults(results);
        setEvalError("");
      })
      .catch((error) => {
        if (cancelled) return;
        setEvalError(describeSyncError(error));
      })
      .finally(() => {
        if (!cancelled) setIsEvalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab, isGuest, evalReloadTick, store.evaluation]);

  useEffect(() => {
    if (tab !== "evaluation" || !isAdmin) return;
    const id = window.setInterval(() => setEvalReloadTick((tick) => tick + 1), 20000);
    return () => window.clearInterval(id);
  }, [tab, isAdmin]);

  useEffect(() => {
    if (tab !== "schedule") return;
    setScheduleNow(Date.now());
    const id = window.setInterval(() => setScheduleNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [tab]);

  const mapPins = useMemo(
    () =>
      ((store.map as MultiMapInfo).locations ?? []).filter(
        (location) => Number.isFinite(location.lat) && Number.isFinite(location.lng),
      ),
    [store.map],
  );
  const savedFocusPin = useMemo(
    () => (schedulePlace ? schedulePinFor(mapPins, schedulePlace.place) : null),
    [mapPins, schedulePlace],
  );
  const focusPin = savedFocusPin ?? geocodedPlace;
  const mapPinsWithFocus = useMemo(
    () => (focusPin && !mapPins.some((location) => location.id === focusPin.id) ? [...mapPins, focusPin] : mapPins),
    [mapPins, focusPin],
  );

  const jumpToMatch = (post: MatchSchedulePost) => {
    setSchedulePlace({ id: post.id, title: post.title, place: post.location });
    setTab("map");
  };

  useEffect(() => {
    if (tab !== "map") {
      setSchedulePlace(null);
      setGeocodedPlace(null);
      setMapPlaceNotice("");
    }
  }, [tab]);

  useEffect(() => {
    if (!schedulePlace || tab !== "map") return;

    if (savedFocusPin) {
      setGeocodedPlace(null);
      setMapPlaceNotice("");
      return;
    }

    const place = schedulePlace.place.trim();
    if (!place) {
      setGeocodedPlace(null);
      setMapPlaceNotice("This schedule post has no location saved, so there is nothing to place on the map.");
      return;
    }

    let cancelled = false;
    setGeocodedPlace(null);
    setMapPlaceNotice(`Searching the map for “${place}”…`);

    fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => response.json())
      .then((results: { lat?: string; lon?: string }[]) => {
        if (cancelled) return;
        const hit = results?.[0];
        if (!hit?.lat || !hit?.lon) {
          setMapPlaceNotice(`“${place}” was not found on the map. An admin can save it as a pin under Add location.`);
          return;
        }
        setGeocodedPlace({
          id: `schedule-${schedulePlace.id}`,
          name: schedulePlace.title,
          address: place,
          lat: Number(hit.lat),
          lng: Number(hit.lon),
        });
        setMapPlaceNotice("");
      })
      .catch(() => {
        if (cancelled) return;
        setMapPlaceNotice(`Could not search for “${place}”. Tap the schedule post again to retry.`);
      });

    return () => {
      cancelled = true;
    };
  }, [schedulePlace, savedFocusPin, tab]);

  useEffect(() => {
    if (session.role === "guest" && !session.username) {
      navigate("/login");
    }
  }, [navigate, session.role, session.username]);

  useEffect(() => {
    const isAccountView = tab === "profile" || tab === "password";

    if (isAccountView ? role === "guest" : !navItems.some((i) => i.k === tab)) {
      setTab(navItems[0]?.k ?? "news");
    }
  }, [navItems, role, tab]);

  useEffect(() => {
    if (isGuest || !session.username || !viewerTutorialEnabled) return;
    const completedKey = `rcess-viewer-tour-complete:${(session.username ?? "viewer").toLowerCase()}`;
    try {
      if (window.localStorage.getItem(completedKey) !== "true") {
        setTab("news");
        setViewerTourStep(0);
        setViewerTourOpen(true);
      }
    } catch {
      setTab("news");
      setViewerTourStep(0);
      setViewerTourOpen(true);
    }
  }, [isGuest, session.username, viewerTutorialEnabled]);

  useEffect(() => {
    if (!viewerTourOpen) {
      setViewerTourRect(null);
      return;
    }

    const step = viewerTourSteps[viewerTourStep];
    if (!step) return;
    setTab(step.tab);

    const isMobileViewport = window.innerWidth < 1024;
    const isMobileDropdownIntro = isMobileViewport && step.target === "navigation";
    setMobileNavOpen(isMobileViewport && !isMobileDropdownIntro);

    const timer = window.setTimeout(() => {
      const navigationKeys = TOUR_TAB_KEYS;
      const isNavigationRange = step.target === "navigation" && !isMobileViewport;
      const visible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };

      const desktopNavigationTargets = isNavigationRange
        ? navigationKeys
            .map((key) => document.querySelector(`[role="tab"][data-tour-target="${key}"]`) as HTMLElement | null)
            .filter((element): element is HTMLElement => Boolean(element && visible(element)))
        : [];
      const mobileNavigationTargets = isNavigationRange
        ? Array.from(document.querySelectorAll('[data-tour-nav-item="true"]')) as HTMLElement[]
        : [];
      const navigationTargets = desktopNavigationTargets.length > 0
        ? desktopNavigationTargets
        : mobileNavigationTargets.filter(visible);

      const mobileDropdownTarget = isMobileDropdownIntro
        ? document.querySelector('[data-tour-target="mobile-menu-toggle"]') as HTMLElement | null
        : null;
      const mobileStepTarget = isMobileViewport && !isMobileDropdownIntro
        ? document.querySelector(`[data-tour-nav-item="true"][data-tour-target="${step.target}"]`) as HTMLElement | null
        : null;
      const candidates = isNavigationRange && navigationTargets.length > 0
        ? navigationTargets
        : mobileDropdownTarget && visible(mobileDropdownTarget)
          ? [mobileDropdownTarget]
          : mobileStepTarget && visible(mobileStepTarget)
            ? [mobileStepTarget]
            : Array.from(document.querySelectorAll(`[data-tour-target="${isNavigationRange ? "news" : step.target}"]`)) as HTMLElement[];
      const target = candidates.find(visible) ?? null;
      if (!target) {
        setViewerTourRect(null);
        return;
      }

      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      window.setTimeout(() => {
        const rects = isNavigationRange && navigationTargets.length > 0
          ? navigationTargets.map((element) => element.getBoundingClientRect())
          : [target.getBoundingClientRect()];
        const bounds = {
          top: Math.min(...rects.map((rect) => rect.top)),
          left: Math.min(...rects.map((rect) => rect.left)),
          right: Math.max(...rects.map((rect) => rect.right)),
          bottom: Math.max(...rects.map((rect) => rect.bottom)),
        };
        const margin = 16;
        const isSmallScreen = window.innerWidth < 640;
        const tipWidth = Math.min(isSmallScreen ? 300 : 360, window.innerWidth - margin * 2);
        const tipHeight = isSmallScreen ? Math.min(230, window.innerHeight - margin * 2) : 245;
        const tipLeft = Math.max(margin, Math.min(bounds.left, window.innerWidth - tipWidth - margin));
        let tipTop = bounds.bottom + 16;
        if (tipTop + tipHeight > window.innerHeight - margin) {
          tipTop = bounds.top - tipHeight - 16;
        }
        tipTop = Math.max(margin, Math.min(tipTop, window.innerHeight - tipHeight - margin));
        setViewerTourRect({
          top: Math.max(4, bounds.top - 8),
          left: Math.max(4, bounds.left - 8),
          width: Math.min(window.innerWidth - 8, bounds.right - bounds.left + 16),
          height: bounds.bottom - bounds.top + 16,
          tipTop,
          tipLeft,
        });
      }, 220);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [viewerTourOpen, viewerTourStep, viewerTourSteps]);

  function moveViewerTourToStep(nextStepIndex: number) {
    const nextStep = viewerTourSteps[nextStepIndex];
    if (!nextStep) return;
    setViewerTourStep(nextStepIndex);
    setTab(nextStep.tab);
    const isMobileViewport = window.innerWidth < 1024;
    setMobileNavOpen(isMobileViewport && nextStep.target !== "navigation");
  }

  function commit(next: Store) {
    setStore(next);
    saveStore(next);
    requestPush(next);
  }

  function requestPush(next: Store) {
    pendingPushRef.current = next;
    if (isPushingRef.current) return;
    void drainPushes();
  }

  async function drainPushes() {
    isPushingRef.current = true;
    setIsPushing(true);

    try {
      while (pendingPushRef.current) {
        const next = pendingPushRef.current;
        pendingPushRef.current = null;

        try {
          const result = await persistStore(next, cloudBaselineRef.current);
          cloudBaselineRef.current = next;
          setPushError("");
          setEventsLocalOnly(!result.eventsStoredInCloud);
        } catch (error) {
          setPushError(describeSyncError(error));
          toast.error(describeSyncError(error));
        }
      }
    } finally {
      isPushingRef.current = false;
      setIsPushing(false);
    }
  }

  function handleLogout() {
    clearSession();
    setSession({ role: "guest" });
    navigate("/");
  }

  function commitIfAdmin(next: typeof store) {
    if (!isAdmin) {
      toast("Admin only");
      return;
    }
    commit(next);
  }

  function commitIfSettingsAllowed(next: typeof store) {
    if (!canEditSettings) {
      toast("No permission to edit Settings");
      return;
    }
    commit(next);
  }

  function commitIfNewsAllowed(next: typeof store) {
    if (!canEditNews) {
      toast("No permission to edit News");
      return;
    }
    commit(next);
  }

  function commitIfSummitAllowed(next: typeof store) {
    if (!canEditSummit) {
      toast("No permission to edit Emergency Hotline");
      return;
    }
    commit(next);
  }

  function commitIfLeaderboardAllowed(next: typeof store) {
    if (!canEditLeaderboard) {
      toast("No permission to edit Leaderboard");
      return;
    }
    commit(next);
  }

  function commitIfBracketsAllowed(next: typeof store) {
    if (!canEditBrackets) {
      toast("No permission to edit Bracketing");
      return;
    }
    commit(next);
  }

  function commitIfScheduleAllowed(next: typeof store) {
    if (!canEditSchedule) {
      toast("No permission to edit Schedule");
      return;
    }
    commit(next);
  }

  function commitIfMapAllowed(next: typeof store) {
    if (!canEditMap) {
      toast("No permission to edit Map");
      return;
    }
    commit(next);
  }

  function editBracketMatch(
    bracket: Bracket,
    section: BracketSection,
    roundIndex: number,
    matchIndex: number,
    change: (match: Match) => void,
  ) {
    if (!canEditBrackets) {
      toast("No permission to edit Bracketing");
      return;
    }

    const nextBrackets = store.brackets.map((current) => {
      if (current.id !== bracket.id) return current;

      const draft = JSON.parse(JSON.stringify(current)) as Bracket;
      const match = bracketMatchAt(draft, section, roundIndex, matchIndex);
      if (!match) return current;

      change(match);
      return propagateBracket(draft, bracketAutoAdvance ? "auto" : "manual");
    });

    commitIfBracketsAllowed({ ...store, brackets: nextBrackets });
  }

  function updateBracketScore(
    bracket: Bracket,
    section: BracketSection,
    roundIndex: number,
    matchIndex: number,
    sideKey: "a" | "b",
    rawValue: string,
  ) {
    const parsedScore = rawValue.trim() === "" ? null : Number(rawValue);
    const score = parsedScore !== null && Number.isFinite(parsedScore) ? parsedScore : null;

    editBracketMatch(bracket, section, roundIndex, matchIndex, (match) => {
      match[sideKey].score = score;
    });
  }

  function advanceBracketMatch(
    bracket: Bracket,
    section: BracketSection,
    roundIndex: number,
    matchIndex: number,
    sideKey: "a" | "b",
  ) {
    editBracketMatch(bracket, section, roundIndex, matchIndex, (match) => {
      match.winner = sideKey;
    });
  }

  function updateStandingPoints(bracket: Bracket, team: string, rawValue: string) {
    if (!canEditBrackets) {
      toast("No permission to edit Bracketing");
      return;
    }

    const parsed = rawValue.trim() === "" ? 0 : Number(rawValue);
    const points = Number.isFinite(parsed) ? parsed : 0;

    const nextBrackets = store.brackets.map((current) => {
      if (current.id !== bracket.id) return current;

      const draft = JSON.parse(JSON.stringify(current)) as Bracket;
      draft.standings = standingsOf(draft).map((row) =>
        row.team === team ? { ...row, points } : row,
      );

      return draft;
    });

    commitIfBracketsAllowed({ ...store, brackets: nextBrackets });
  }

  const latestNews = store.news[0];
  const accountButtonClass = (key: string) =>
    tab === key
      ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/20"
      : "border-white/20 bg-transparent text-white hover:bg-white/10";
  const summitItems: (SummitInfo & { id: string })[] =
    ((store as any).summits as (SummitInfo & { id: string })[] | undefined) ??
    (store.summit ? [{ ...store.summit, id: "legacy-summit" }] : []);

  // The category scope narrows the event dropdown and the bracket list; a
  // category that no longer exists falls back to showing everything.
  const bracketCategoryScope =
    store.settings.events.find((category) => category.name === bracketCategoryFilter) ?? null;
  const bracketEventFilter = !bracketCategoryScope ||
    bracketCategoryScope.events.some((event) => event.name === bracketSportFilter)
    ? bracketSportFilter
    : "ALL";
  const visibleBrackets = store.brackets.filter((bracket) => {
    const category = categoryOfEvent(store.settings.events, bracket.sport);
    if (bracketCategoryScope && category?.name !== bracketCategoryScope.name) return false;
    return bracketEventFilter === "ALL" || bracket.sport === bracketEventFilter;
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030530] text-white">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[#030530]"
        aria-hidden="true"
      />
      <div className="rcess-grid pointer-events-none" aria-hidden="true" />
      <div className="rcess-vignette pointer-events-none" aria-hidden="true" />
      <div className="rcess-scanlines pointer-events-none" aria-hidden="true" />
      <div className="rcess-cornerglow pointer-events-none" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1500px] px-3 sm:px-5 md:px-8 lg:px-10 py-8 sm:py-10 md:py-12">
        <div className="hidden lg:flex items-center justify-end gap-2 mb-3">
          {role !== "guest" ? (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">Account</span>
              <Button
                size="sm"
                variant="outline"
                className={accountButtonClass("profile")}
                data-tour-target="profile"
                onClick={() => setTab("profile")}
              >
                <User className="mr-2 h-4 w-4" /> Profile
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={accountButtonClass("password")}
                data-tour-target="password"
                onClick={() => setTab("password")}
              >
                <KeyRound className="mr-2 h-4 w-4" /> Change password
              </Button>
            </div>
          ) : null}
          <Button
            variant="outline"
            className="border-white/20 bg-transparent text-white hover:bg-white/10"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        </div>

        <PortalHeader />

        {pullError || pushError || isPushing ? (
          <div className="mt-4 grid gap-2">
            {pullError || pushError ? (
              <div
                role="alert"
                className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200"
              >
                {pushError
                  ? `Supabase rejected the save: ${pushError}`
                  : `Could not load the portal from Supabase: ${pullError}`}
              </div>
            ) : null}

            {isPushing ? (
              <div className="text-xs text-white/45">Saving to Supabase…</div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 md:mt-10">
          <Card className="rcess-panel p-0 w-full min-h-[70vh]">
            <div className="p-6 sm:p-7 md:p-9 lg:p-10">
              <div className="text-[11px] tracking-[0.45em] text-white/45">TAB SECTION</div>
              <div className="mt-2 text-2xl font-semibold">
                {(
                  {
                    news: "News Dashboard",
                    feed: "News Feed",
                    summit: "Emergency Hotline",
                    leaderboard: "Leaderboard",
                    bracketing: "Bracketing",
                    schedule: "Schedule",
                    map: "Map",
                    evaluation: "Evaluation",
                    profile: "Account · Profile",
                    password: "Account · Change password",
                    settings: "Settings",
                  } as Record<string, string>
                )[tab] ?? "Dashboard"}
              </div>
              {!isAdmin ? (
                <div className="mt-2 text-sm text-white/55">
                  You are viewing in <span className="text-white/75">read-only</span> mode for some sections.
                </div>
              ) : null}

              <Tabs value={tab} onValueChange={setTab} className="mt-5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  {/* Desktop tabs */}
                  <TabsList className="hidden lg:flex bg-black/25 border border-white/10 p-1 rounded-xl w-full max-w-full overflow-x-auto justify-start">
                    {desktopTabs.map((t) => {
                      const Icon = t.icon;
                      return (
                        <TabsTrigger
                          key={t.k}
                          value={t.k}
                          data-tour-target={TOUR_TAB_KEYS.includes(t.k) ? t.k : undefined}
                          className="gap-2 data-[state=active]:bg-white/10 shrink-0"
                        >
                          <Icon className="h-4 w-4" /> {t.t}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Mobile dropdown navigation (upper-left) */}
                    <Sheet
                      open={mobileNavOpen || mobileTutorialMenuMustStayOpen}
                      onOpenChange={(open) => {
                        if (!open && mobileTutorialMenuMustStayOpen) return;
                        if (!open && viewerTourOpen && mobileNavOpen) return;
                        setMobileNavOpen(open);
                      }}
                    >
                      <SheetTrigger asChild>
                        <Button
                          variant="outline"
                          className="lg:hidden border-white/20 bg-transparent text-white hover:bg-white/10"
                          aria-label="Open menu"
                          data-tour-target="mobile-menu-toggle"
                        >
                          <span className="max-w-[180px] truncate">
                            Menu
                          </span>
                          <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent side="left" className="bg-black/90 border-white/15 text-white w-[320px]">
                        <SheetHeader>
                          <SheetTitle className="text-white">Menu</SheetTitle>
                        </SheetHeader>
                        <div className="mt-4">
                          <Command className="bg-transparent">
                            <CommandInput placeholder="Search menu..." className="text-white" />
                            <CommandList>
                              <CommandEmpty>No results.</CommandEmpty>
                              <CommandGroup heading="Jump to">
                                {navItems.map((i) => (
                                    <CommandItem
                                      key={i.k}
                                      value={i.t}
                                      data-tour-target={TOUR_TAB_KEYS.includes(i.k) ? i.k : undefined}
                                      data-tour-nav-item={TOUR_TAB_KEYS.includes(i.k) ? "true" : undefined}
                                      onSelect={() => {
                                        setTab(i.k);
                                        if (!viewerTourOpen) setMobileNavOpen(false);
                                      }}
                                      className="text-white aria-selected:bg-white/10"
                                    >
                                      {i.t}
                                    </CommandItem>
                                  ))}
                              </CommandGroup>
                              <CommandGroup heading={session.username ? `Account · ${session.username}` : "Account"}>
                                {role !== "guest" ? (
                                  <>
                                    <CommandItem
                                      value="Profile"
                                      data-tour-target="profile"
                                      data-tour-nav-item="true"
                                      onSelect={() => {
                                        setTab("profile");
                                        if (!viewerTourOpen) setMobileNavOpen(false);
                                      }}
                                      className="text-white aria-selected:bg-white/10"
                                    >
                                      Profile
                                    </CommandItem>
                                    <CommandItem
                                      value="Change password"
                                      data-tour-target="password"
                                      data-tour-nav-item="true"
                                      onSelect={() => {
                                        setTab("password");
                                        if (!viewerTourOpen) setMobileNavOpen(false);
                                      }}
                                      className="text-white aria-selected:bg-white/10"
                                    >
                                      Change password
                                    </CommandItem>
                                  </>
                                ) : null}
                                <CommandItem
                                  value="Logout"
                                  onSelect={handleLogout}
                                  className="text-white aria-selected:bg-white/10"
                                >
                                  Logout
                                </CommandItem>
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </div>
                      </SheetContent>
                    </Sheet>


                    {/* Desktop logout removed from here */}
                  </div>
                </div>

                {/* NEWS */}
                <TabsContent value="news" className="mt-5">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">News and Announcements</div>
                        <div className="mt-1 text-sm text-white/50">
                          Showing {Math.min(newsLimit, store.news.length)} of {store.news.length}
                        </div>
                      </div>
                      {!isReadOnly ? (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button className="bg-cyan-300 text-black hover:bg-cyan-200" disabled={!canEditNews} title={!canEditNews ? "No permission" : undefined}>
                              Add news
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="bg-black/80 border-white/15 text-white">
                            <DialogHeader><DialogTitle>Add news</DialogTitle></DialogHeader>
                            <NewsEditor onSave={(item) => {
                              commitIfNewsAllowed({ ...store, news: [item, ...store.news] });
                              toast.success("News saved");
                            }} />
                          </DialogContent>
                        </Dialog>
                      ) : null}
                    </div>

                    {store.news.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-6 text-sm text-white/50">No news yet.</div>
                    ) : (
                      store.news.slice(0, newsLimit).map((item) => (
                        <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-lg font-semibold break-words">{item.title}</div>
                              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/60">{item.body}</div>
                              <div className="mt-4 text-xs text-white/40">Posted: {formatPosted(item.postedAtIso)}</div>
                            </div>
                            <Badge className="w-fit bg-white text-black hover:bg-white">{item.type}</Badge>
                          </div>
                          {!isReadOnly ? (
                            <div className="mt-4">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10" disabled={!canEditNews} title={!canEditNews ? "No permission" : undefined}>Edit news</Button>
                                </DialogTrigger>
                                <DialogContent className="bg-black/80 border-white/15 text-white">
                                  <DialogHeader><DialogTitle>Edit news</DialogTitle></DialogHeader>
                                  <NewsEditor item={item} onSave={(next) => {
                                    commitIfNewsAllowed({ ...store, news: store.news.map((n) => n.id === next.id ? next : n) });
                                    toast.success("News updated");
                                  }} onDelete={(newsItem) => {
                                    commitIfNewsAllowed({ ...store, news: store.news.filter((n) => n.id !== newsItem.id) });
                                    toast.success("News deleted");
                                  }} />
                                </DialogContent>
                              </Dialog>
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}

                    {store.news.length > newsLimit ? (
                      <Button
                        variant="outline"
                        className="w-full border-white/20 bg-transparent text-white hover:bg-white/10"
                        onClick={() => setNewsLimit((limit) => limit + NEWS_PAGE_SIZE)}
                      >
                        {`Load the next ${Math.min(NEWS_PAGE_SIZE, store.news.length - newsLimit)} ${
                          store.news.length - newsLimit === 1 ? "post" : "posts"
                        }`}
                      </Button>
                    ) : null}
                  </div>
                </TabsContent>

                {/* NEWS FEED */}
                <TabsContent value="feed" className="mt-5">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div data-tour-target="feed" className="text-lg font-semibold">Photo Feed</div>
                        <div className="mt-1 text-sm text-white/50">
                          Showing {feed.length} · {FEED_PAGE_SIZE}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isGuest ? (
                          <Dialog open={isComposerOpen} onOpenChange={setIsComposerOpen}>
                            <DialogTrigger asChild>
                              <Button
                                className="bg-cyan-300 text-black hover:bg-cyan-200"
                                data-tour-target="feed-add"
                              >
                                Add post
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="rcess-composer-dialog bg-black/80 border-white/15 text-white">
                              <DialogHeader className="shrink-0"><DialogTitle>Add post</DialogTitle></DialogHeader>
                              <FeedComposer
                                postedBy={session.username ?? role}
                                onPosted={() => {
                                  setIsComposerOpen(false);
                                  setFeedReloadTick((tick) => tick + 1);
                                }}
                              />
                            </DialogContent>
                          </Dialog>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-white/20 bg-transparent text-white hover:bg-white/10"
                          disabled={isFeedLoading}
                          onClick={() => setFeedReloadTick((tick) => tick + 1)}
                        >
                          {isFeedLoading ? "Loading…" : "Refresh"}
                        </Button>
                      </div>
                    </div>

                    {feedError ? (
                      <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-white/70">
                        {feedError}
                        <div className="mt-1 text-white/45">
                          If the feed tables are missing, run supabase/feed.sql in the Supabase SQL editor.
                        </div>
                      </div>
                    ) : null}

                    {feed.length === 0 && !feedError ? (
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-6 text-sm text-white/50">
                        No posts yet. Use Add post to share a picture, a caption, or both.
                      </div>
                    ) : (
                      feed.map((post, index) => {
                        const isMine = Boolean(session.username) && post.postedBy === session.username;

                        return (
                          <div
                            key={post.id}
                            data-tour-target={index === 0 ? "feed-post" : undefined}
                            onContextMenu={(event) => event.preventDefault()}
                            className="rcess-feed-post rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6"
                          >
                            <div className={post.imagePaths.length > 1 ? "grid grid-cols-2 gap-3" : ""}>
                              {post.imagePaths.slice(0, 2).map((path, photoIndex, preview) => {
                                const hiddenCount = post.imagePaths.length - preview.length;
                                const showsMore = hiddenCount > 0 && photoIndex === preview.length - 1;

                                return (
                                  <button
                                    key={path}
                                    type="button"
                                    onClick={() => setOpenFeedPost(post)}
                                    onContextMenu={(event) => event.preventDefault()}
                                    className="relative block w-full cursor-zoom-in text-left"
                                    aria-label={showsMore ? `Open post — ${hiddenCount} more pictures` : "Open post"}
                                  >
                                    <img
                                      src={feedImageUrl(path)}
                                      alt={post.caption || `Picture from ${post.postedBy}`}
                                      loading="lazy"
                                      draggable={false}
                                      className={
                                        post.imagePaths.length > 1
                                          ? "rcess-feed-photo aspect-square w-full rounded-xl border border-white/10 object-cover"
                                          : "rcess-feed-photo max-h-[28rem] w-full rounded-xl border border-white/10 object-contain"
                                      }
                                    />
                                    {showsMore ? (
                                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/55 text-xl font-semibold tracking-[0.06em] text-white/90 sm:text-3xl">
                                        +{hiddenCount} more
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                            {post.imagePaths.length === 0 ? (
                              <button
                                type="button"
                                onClick={() => setOpenFeedPost(post)}
                                className="mt-3 text-sm text-cyan-200/80 underline-offset-4 hover:text-cyan-100 hover:underline"
                              >
                                Open post
                              </button>
                            ) : null}
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/40">
                              <span>
                                Posted by {post.postedBy || "unknown"} · {formatPosted(post.postedAtIso)} ·{" "}
                                {post.imagePaths.length === 0
                                  ? ""
                                  : `${post.imagePaths.length} ${post.imagePaths.length === 1 ? "picture" : "pictures"}`}
                              </span>
                              <span className="flex flex-wrap items-center justify-end gap-2">
                                {isMine && !isAdmin ? (
                                  <span className="text-white/35">Yours · open the post to delete it</span>
                                ) : null}
                                {isAdmin && post.imagePaths.length ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                    onClick={() => setDownloadFeedPost(post)}
                                  >
                                    <Download className="mr-2 h-4 w-4" />
                                    Download
                                  </Button>
                                ) : null}
                                {isAdmin ? (
                                  <FeedDeleteButton
                                    post={post}
                                    label="Delete"
                                    confirming={feedConfirmId === post.id}
                                    busy={isFeedDeleting}
                                    onAsk={(target) => setFeedConfirmId(target.id)}
                                    onCancel={() => setFeedConfirmId(null)}
                                    onConfirm={handleFeedDelete}
                                  />
                                ) : null}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {feed.length === feedLimit ? (
                      <Button
                        variant="outline"
                        className="w-full border-white/20 bg-transparent text-white hover:bg-white/10"
                        disabled={isFeedLoading}
                        onClick={() => setFeedLimit((limit) => limit + FEED_PAGE_SIZE)}
                      >
                        {isFeedLoading
                          ? "Loading…"
                          : `Load the next ${FEED_PAGE_SIZE} posts`}
                      </Button>
                    ) : null}
                  </div>
                </TabsContent>

                {/* EMERGENCY HOTLINE */}
                <TabsContent value="summit" className="mt-5">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div data-tour-target="summit" className="text-lg font-semibold">Emergency Hotline</div>
                      </div>
                      {!isReadOnly ? (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button className="bg-cyan-300 text-black hover:bg-cyan-200" disabled={!canEditSummit} title={!canEditSummit ? "No permission" : undefined}>
                              Add hotline contact
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="bg-black/80 border-white/15 text-white">
                            <DialogHeader><DialogTitle>Add emergency hotline contact</DialogTitle></DialogHeader>
                            <SummitEditor value={{ title: "", subtitle: "", venue: "", dateLabel: "", notes: "" }} onSave={(value) => {
                              const nextItem = { ...value, id: nanoId() };
                              const nextSummits = [nextItem, ...summitItems.filter((x) => x.id !== "legacy-summit")];
                              commitIfSummitAllowed({ ...store, summit: value, summits: nextSummits } as typeof store);
                              toast.success("Emergency hotline contact added");
                            }} />
                          </DialogContent>
                        </Dialog>
                      ) : null}
                    </div>

                    {summitItems.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-6 text-sm text-white/50">
                        No emergency hotline contacts yet. An administrator can add a contact.
                      </div>
                    ) : (
                      summitItems.map((item) => {
                        const phoneNumbers = extractEmergencyPhoneNumbers(item);
                        return (
                          <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
                                <PhoneCall className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-lg font-semibold break-words">{item.title || "Emergency Hotline"}</div>
                                {item.subtitle ? <div className="mt-1 text-sm text-white/55">{item.subtitle}</div> : null}
                              </div>
                            </div>
                            <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
                              <div className="text-xs tracking-[0.18em] text-white/45">
                                CONTACT NUMBER{phoneNumbers.length === 1 ? "" : "S"}
                                {phoneNumbers.length > 1 ? (
                                  <span className="ml-2 text-white/35">· {phoneNumbers.length}</span>
                                ) : null}
                              </div>
                              {phoneNumbers.length > 0 ? (
                                <div className="mt-2 space-y-2">
                                  {phoneNumbers.map((phoneNumber) => (
                                    <div key={phoneNumber} className="flex flex-wrap items-center gap-3">
                                      <a
                                        href={`tel:${phoneNumber.replace(/[^\d+]/g, "")}`}
                                        className="inline-block text-xl font-semibold text-cyan-200 underline decoration-cyan-300/40 underline-offset-4 hover:text-cyan-100"
                                      >
                                        {phoneNumber}
                                      </a>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="border-cyan-300/25 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
                                        onClick={async () => {
                                          const copied = await copyTextToClipboard(phoneNumber);
                                          if (copied) toast.success("Contact number copied");
                                          else toast.error("Could not copy the contact number. Please select and copy it manually.");
                                        }}
                                      >
                                        <Copy className="mr-2 h-4 w-4" /> Copy number
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-1 text-sm text-white/55">
                                  No contact number was found in the saved Emergency Hotline details. An admin can enter the number using Edit hotline contact.
                                </div>
                              )}
                            </div>
                            {item.dateLabel ? (
                              <div className="mt-3 text-sm text-white/60">
                                <span className="text-white/45">Availability:</span> {item.dateLabel}
                              </div>
                            ) : null}
                            {item.notes ? <div className="mt-3 whitespace-pre-wrap text-sm text-white/55">{item.notes}</div> : null}
                            {!isReadOnly ? (
                              <div className="mt-5">
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10" disabled={!canEditSummit} title={!canEditSummit ? "No permission" : undefined}>
                                      Edit hotline contact
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="bg-black/80 border-white/15 text-white">
                                    <DialogHeader><DialogTitle>Edit emergency hotline contact</DialogTitle></DialogHeader>
                                    <SummitEditor value={item} onSave={(value) => {
                                      const nextSummits = summitItems.map((x) => x.id === item.id ? { ...value, id: item.id } : x);
                                      commitIfSummitAllowed({ ...store, summit: value, summits: nextSummits } as typeof store);
                                      toast.success("Emergency hotline contact updated");
                                    }} onDelete={() => {
                                      const nextSummits = summitItems.filter((x) => x.id !== item.id);
                                      const nextSummit = nextSummits[0] ?? null;
                                      commitIfSummitAllowed({ ...store, summit: nextSummit, summits: nextSummits } as typeof store);
                                      toast.success("Emergency hotline contact deleted");
                                    }} />
                                  </DialogContent>
                                </Dialog>
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </TabsContent>

                {/* SCHEDULE */}
                <TabsContent value="schedule" className="mt-5">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div>
                        <div data-tour-target="schedule" className="text-lg font-semibold">Schedule</div>
                       
                      </div>

                      {canEditSchedule ? (
                        <div className="flex items-center gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button className="bg-cyan-300 text-black hover:bg-cyan-200">Add schedule</Button>
                            </DialogTrigger>
                            <DialogContent className="bg-black/80 border-white/15 text-white">
                              <DialogHeader>
                                <DialogTitle>Add schedule post</DialogTitle>
                              </DialogHeader>

                              <ScheduleEditor
                                onSave={(post) => {
                                  commitIfScheduleAllowed({ ...store, schedule: [post, ...(store.schedule ?? [])] });
                                  toast.success("Schedule posted");
                                }}
                              />
                            </DialogContent>
                          </Dialog>
                        </div>
                      ) : null}
                    </div>

                    {(() => {
                      const now = new Date(scheduleNow);

                      const items = (store.schedule ?? [])
                        .filter((p) => canEditSchedule || scheduleIsVisible(p, now))
                        .slice()
                        .sort(
                          (a, b) =>
                            Number(scheduleIsVisible(b, now)) - Number(scheduleIsVisible(a, now)) ||
                            new Date(a.postedAtIso).getTime() - new Date(b.postedAtIso).getTime(),
                        );

                      const latest = items[0];
                      const rest = items.slice(1);
                      const latestBadge = latest ? scheduleWindowBadge(latest, now) : null;

                      return (
                        <>
                          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                            <div className="flex items-start justify-between gap-4">
                              <button
                                type="button"
                                disabled={!latest}
                                onClick={() => latest && jumpToMatch(latest)}
                                className="min-w-0 cursor-pointer text-left disabled:cursor-default"
                              >
                                <div className="text-lg font-semibold">{latest ? latest.title : 'Nothing on the schedule'}</div>
                                <div className="mt-2 text-sm text-white/60">
                                  {latest ? (
                                    <>
                                      <span className="text-white/45">Time:</span>{' '}
                                      {scheduleTimeLabel(latest.timeText) || 'Time to be announced'}
                                      {latest.location ? (
                                        <>
                                          {' '}• <span className="text-white/45">Location:</span> {latest.location}
                                        </>
                                      ) : null}
                                    </>
                                  ) : (
                                    'Nothing is due to appear right now. Posts show during their scheduled window.'
                                  )}
                                </div>
                                {latest ? (
                                  <div className="mt-4 text-xs text-white/40">Posted: {new Date(latest.postedAtIso).toLocaleString()}</div>
                                ) : null}
                                {canEditSchedule && latestBadge ? (
                                  <div className="mt-1 text-xs text-amber-300/80">{latestBadge}</div>
                                ) : null}
                                {latest?.location ? (
                                  <div className="mt-3 inline-flex items-center gap-1 text-xs text-cyan-200/75">
                                    <MapPinned className="h-3.5 w-3.5" /> Tap to see it on the map
                                  </div>
                                ) : null}
                              </button>
                              {canEditSchedule && latest ? (
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                    onClick={() => {
                                      commitIfScheduleAllowed({
                                        ...store,
                                        schedule: (store.schedule ?? []).filter((x) => x.id !== latest.id),
                                      });
                                      toast("Schedule removed");
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3">
                            {rest.map((p) => (
                              <div key={p.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <button
                                    type="button"
                                    onClick={() => jumpToMatch(p)}
                                    className="min-w-0 cursor-pointer text-left"
                                  >
                                    <div className="text-sm font-semibold">{p.title}</div>
                                    <div className="mt-1 text-sm text-white/55">
                                      <span className="text-white/45">Time:</span> {scheduleTimeLabel(p.timeText) || 'Time to be announced'}
                                      {p.location ? <> • <span className="text-white/45">Location:</span> {p.location}</> : null}
                                    </div>
                                    <div className="mt-2 text-xs text-white/40">Posted: {new Date(p.postedAtIso).toLocaleString()}</div>
                                    {canEditSchedule && scheduleWindowBadge(p, now) ? (
                                      <div className="mt-1 text-xs text-amber-300/80">{scheduleWindowBadge(p, now)}</div>
                                    ) : null}
                                    {p.location ? (
                                      <div className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200/75">
                                        <MapPinned className="h-3.5 w-3.5" /> Tap to see it on the map
                                      </div>
                                    ) : null}
                                  </button>
                                  {canEditSchedule ? (
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                        onClick={() => {
                                          commitIfScheduleAllowed({ ...store, schedule: (store.schedule ?? []).filter((x) => x.id !== p.id) });
                                          toast('Schedule removed');
                                        }}
                                      >
                                        Delete
                                      </Button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ))}

                            {items.length === 0 ? (
                              <div className="text-sm text-white/45">Nothing is visible right now.</div>
                            ) : rest.length === 0 ? (
                              <div className="text-sm text-white/45">No other schedule posts.</div>
                            ) : null}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </TabsContent>

{/* MAP */}
                <TabsContent value="map" className="mt-5">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div data-tour-target="map" className="text-lg font-semibold">Map</div>
                      </div>
                      {!isReadOnly ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Dialog
                            open={isMapEditorOpen}
                            onOpenChange={(open) => {
                              setMapEditorOpen(open);
                              if (!open) setMapEditorFocus(null);
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button
                                className="bg-cyan-300 text-black hover:bg-cyan-200"
                                disabled={!canEditMap}
                                title={!canEditMap ? "No permission" : undefined}
                                onClick={() => setMapEditorFocus(NEW_LOCATION_ID)}
                              >
                                Add location
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-h-[90vh] overflow-y-auto border-white/15 bg-black/80 text-white">
                              <DialogHeader>
                                <DialogTitle>
                                  {mapEditorFocus && mapEditorFocus !== NEW_LOCATION_ID ? "Edit location" : "Add location"}
                                </DialogTitle>
                              </DialogHeader>
                              <MapEditor
                                value={store.map}
                                focusId={mapEditorFocus}
                                onSave={(v) => {
                                  commitIfMapAllowed({ ...store, map: v });
                                  setMapEditorOpen(false);
                                  setMapManagerOpen(true);
                                  toast.success("Map updated");
                                }}
                              />
                            </DialogContent>
                          </Dialog>

                          <Dialog open={isMapManagerOpen} onOpenChange={setMapManagerOpen}>
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                disabled={!canEditMap}
                                title={!canEditMap ? "No permission" : undefined}
                              >
                                Manage locations
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-h-[90vh] overflow-y-auto border-white/15 bg-black/80 text-white">
                              <DialogHeader>
                                <DialogTitle>Saved locations</DialogTitle>
                              </DialogHeader>
                              <div className="grid gap-3">
                                <div className="text-xs leading-relaxed text-white/45">
                                  Every pin the map shows. Edit opens that location on its own, Remove takes it off
                                  the map for everyone.
                                </div>
                                {((store.map as MultiMapInfo).locations ?? []).map((location, index) => (
                                  <div
                                    key={location.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 p-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium text-white">
                                        {index + 1}. {location.name}
                                      </div>
                                      <div className="mt-1 text-xs text-white/50 break-words">{location.address}</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                        onClick={() => {
                                          setMapEditorFocus(location.id);
                                          setMapManagerOpen(false);
                                          setMapEditorOpen(true);
                                        }}
                                      >
                                        Edit
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-red-400/30 bg-transparent text-red-200 hover:bg-red-500/10"
                                        onClick={() => {
                                          commitIfMapAllowed({
                                            ...store,
                                            map: {
                                              ...store.map,
                                              locations: ((store.map as MultiMapInfo).locations ?? []).filter(
                                                (item) => item.id !== location.id,
                                              ),
                                            },
                                          });
                                          toast.success(`${location.name} removed from the map`);
                                        }}
                                      >
                                        Remove
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                                {((store.map as MultiMapInfo).locations ?? []).length === 0 ? (
                                  <div className="text-xs text-white/45">
                                    No locations saved yet. Add one and it appears here as a pin.
                                  </div>
                                ) : null}
                                <Button
                                  variant="outline"
                                  className="w-fit border-cyan-300/40 bg-transparent text-cyan-200 hover:bg-cyan-300/10"
                                  onClick={() => {
                                    setMapEditorFocus(NEW_LOCATION_ID);
                                    setMapManagerOpen(false);
                                    setMapEditorOpen(true);
                                  }}
                                >
                                  Add location
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      ) : null}
                    </div>

                    {schedulePlace ? (
                      <div className="mt-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.07] p-4">
                        <div className="min-w-0">
                          <div className="text-xs tracking-[0.18em] text-white/45">FROM SCHEDULE</div>
                          <div className="mt-1 text-sm font-semibold break-words">{schedulePlace.title}</div>
                          <div className="text-xs text-white/55 break-words">
                            {schedulePlace.place || "No location saved on this post"}
                          </div>
                          {mapPlaceNotice ? (
                            <div className="mt-1 text-xs text-amber-300/85">{mapPlaceNotice}</div>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-white/20 bg-transparent text-white hover:bg-white/10"
                          onClick={() => setTab("schedule")}
                        >
                          Back to schedule
                        </Button>
                      </div>
                    ) : null}

                    <div className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                      {focusPin ? (
                        <MultiLocationMap locations={mapPinsWithFocus} focus={focusPin} />
                      ) : mapPins.length ? (
                        <MultiLocationMap locations={mapPins} />
                      ) : store.map.embedUrl ? (
                        <iframe title="Existing Google map" src={store.map.embedUrl} className="h-[300px] sm:h-[420px] w-full" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
                      ) : (
                        <div className="p-6 text-sm text-white/45">No locations added yet. Select “Add location” to place your first pin, or “Manage locations” to see what is saved.</div>
                      )}
                    </div>
                    {Array.isArray((store.map as MultiMapInfo).locations) && (store.map as MultiMapInfo).locations!.length > 0 ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {(store.map as MultiMapInfo).locations!.map((location, index) => (
                          <div key={location.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="text-sm font-medium text-white">{index + 1}. {location.name}</div>
                            <div className="mt-1 text-xs text-white/50">{location.address}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {store.map.notes ? <div className="mt-3 text-xs text-white/40">{store.map.notes}</div> : null}
                  </div>
                </TabsContent>

                {/* LEADERBOARD */}
                <TabsContent value="leaderboard" className="mt-5">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                    {(() => {
                      const leaderboardCategories = ["Overall", ...store.settings.sports];
                      const categoryScores = categoryScoreRows(store);
                      const categoryViews = store.settings.events
                        .filter((category) => category.events.length)
                        .map((category) => categoryView(category.name));
                      const scoreViewOptions = ["Overall", ...categoryViews, ...store.settings.sports];
                      const activeScoreView = scoreViewOptions.includes(leaderboardSportFilter)
                        ? leaderboardSportFilter
                        : "Overall";

                      const activeLeaderboardRows = [...store.leaderboard, ...categoryScores]
                        .filter((row) => (row.sport ?? "Overall") === activeScoreView)
                        .slice()
                        .sort((a, b) => b.points - a.points || a.team.localeCompare(b.team));

                      const payouts = payoutsForBrackets(store);
                      const previewOverall = leaderboardWithPayouts(store, payouts)
                        .filter((row) => (row.sport ?? "Overall") === "Overall")
                        .sort((a, b) => b.points - a.points);

                      return (
                        <>
                          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                            <div>
                              <div data-tour-target="leaderboard" className="text-lg font-semibold">Leaderboard</div>
                              

                              <div className="mt-4 flex flex-wrap items-center gap-3">
                                <div className="text-xs tracking-[0.18em] text-white/50">SCORE VIEW</div>
                                <Select value={activeScoreView} onValueChange={(v) => setLeaderboardSportFilter(v as any)}>
                                  <SelectTrigger className="h-9 w-full sm:w-[240px] bg-black/30 border-white/15 text-white">
                                    <SelectValue placeholder="Select score view" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Overall">Overall score</SelectItem>
                                    {categoryViews.length ? (
                                      <SelectGroup>
                                        <SelectLabel>Category totals</SelectLabel>
                                        {store.settings.events
                                          .filter((category) => category.events.length)
                                          .map((category) => (
                                            <SelectItem
                                              key={`cat-${category.id}`}
                                              value={categoryView(category.name)}
                                            >
                                              {category.name} · all events
                                            </SelectItem>
                                          ))}
                                      </SelectGroup>
                                    ) : null}
                                    <SelectGroup>
                                      <SelectLabel>Event scores</SelectLabel>
                                      {store.settings.sports.map((sport) => (
                                        <SelectItem key={sport} value={sport}>
                                          {scoreViewLabel(sport)}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </div>

                              {isCategoryView(activeScoreView) ? (
                                <div className="mt-2 text-xs text-white/35">
                                  Every {categoryViewLabel(activeScoreView)} event added up per team.
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                            {!isReadOnly ? (
                              <Dialog open={isPayoutDialogOpen} onOpenChange={setPayoutDialogOpen}>
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className="border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
                                    disabled={!canEditLeaderboard || payouts.length === 0}
                                    title={
                                      payouts.length === 0
                                        ? "Create a bracket first"
                                        : !canEditLeaderboard
                                          ? "No permission"
                                          : undefined
                                    }
                                  >
                                    Apply points from brackets
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-h-[90vh] overflow-y-auto border-white/15 bg-black/85 text-white">
                                  <DialogHeader>
                                    <DialogTitle>Points from bracketing</DialogTitle>
                                  </DialogHeader>

                                  <div className="grid gap-4">

                                    {payouts.map((payout) => (
                                      <div key={payout.event} className="rounded-xl border border-white/10 bg-black/30 p-3">
                                        <div className="text-sm font-medium text-white">
                                          {payout.event}
                                          {payout.category ? (
                                            <span className="text-white/40"> · {payout.category}</span>
                                          ) : null}
                                        </div>
                                        <div className="text-xs text-white/35">{payout.brackets.join(", ")}</div>
                                        <div className="mt-2 grid gap-1">
                                          {payout.rows
                                            .slice()
                                            .sort((a, b) => b.points - a.points)
                                            .map((row) => (
                                              <div
                                                key={`${row.team}-${row.reason}`}
                                                className="flex items-center justify-between gap-3 text-xs"
                                              >
                                                <span className="min-w-0 truncate text-white/80">{row.team}</span>
                                                <span className="shrink-0 text-white/45">{row.reason}</span>
                                                <span className="shrink-0 text-cyan-200">{row.points}</span>
                                              </div>
                                            ))}
                                          {payout.rows.length === 0 ? (
                                            <div className="text-xs text-white/35">
                                              Nothing to pay out yet — decide the final first.
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                    ))}

                                    {previewOverall.length ? (
                                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                        <div className="text-xs tracking-[0.18em] text-white/50">OVERALL AFTER APPLYING</div>
                                        <div className="mt-2 grid gap-1">
                                          {previewOverall.slice(0, 15).map((row) => (
                                            <div key={row.id} className="flex items-center justify-between gap-3 text-xs">
                                              <span className="min-w-0 truncate text-white/80">{row.team}</span>
                                              <span className="shrink-0 text-cyan-200">{row.points}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}

                                    <div className="flex justify-end">
                                      <Button
                                        className="bg-cyan-300 text-black hover:bg-cyan-200"
                                        disabled={!canEditLeaderboard}
                                        onClick={() => {
                                          if (!canEditLeaderboard) return;
                                          commitIfLeaderboardAllowed({
                                            ...store,
                                            leaderboard: leaderboardWithPayouts(store, payouts),
                                          });
                                          setPayoutDialogOpen(false);
                                          toast.success("Points applied to the leaderboard");
                                        }}
                                      >
                                        Apply to leaderboard
                                      </Button>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            ) : null}

                            <Dialog>
                              <DialogTrigger asChild>
                                {!isReadOnly ? (
                                  <Button
                                    className="bg-cyan-300 text-black hover:bg-cyan-200"
                                    disabled={!canEditLeaderboard}
                                    title={!canEditLeaderboard ? "No permission" : undefined}
                                  >
                                    Add row
                                  </Button>
                                ) : null}
                              </DialogTrigger>
                              <DialogContent className="bg-black/80 border-white/15 text-white">
                                <DialogHeader>
                                  <DialogTitle>Add leaderboard row</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-4">
                                  <div className="grid gap-2">
                                    <label className="text-xs tracking-[0.18em] text-white/60">SCORE VIEW</label>
                                    <select
                                      id="lb-sport"
                                      defaultValue={
                                        leaderboardCategories.includes(activeScoreView) ? activeScoreView : "Overall"
                                      }
                                      className="h-10 rounded-md border border-white/15 bg-black/30 px-3 text-sm text-white"
                                    >
                                      {leaderboardCategories.map((category) => (
                                        <option key={category} value={category} className="bg-black text-white">
                                          {scoreViewLabel(category)}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="grid gap-2">
                                    <label className="text-xs tracking-[0.18em] text-white/60">TEAM</label>
                                    <Input id="lb-team" className="bg-black/30 border-white/15 text-white" placeholder="Team name" />
                                  </div>
                                  <div className="grid gap-2">
                                    <label className="text-xs tracking-[0.18em] text-white/60">POINTS</label>
                                    <Input id="lb-points" type="number" className="bg-black/30 border-white/15 text-white" placeholder="0" />
                                  </div>
                                  <div className="flex justify-end">
                                    <Button
                                      className="bg-cyan-300 text-black hover:bg-cyan-200"
                                      onClick={() => {
                                        if (!canEditLeaderboard) return;
                                        const sportEl = document.getElementById('lb-sport') as HTMLSelectElement | null;
                                        const teamEl = document.getElementById('lb-team') as HTMLInputElement | null;
                                        const ptsEl = document.getElementById('lb-points') as HTMLInputElement | null;
                                        const sport = (sportEl?.value ?? activeScoreView) || "Overall";
                                        const team = (teamEl?.value ?? '').trim();
                                        const points = Number(ptsEl?.value ?? 0);
                                        if (!team) {
                                          toast.error('Team is required');
                                          return;
                                        }
                                        commitIfLeaderboardAllowed({
                                          ...store,
                                          leaderboard: [
                                            ...store.leaderboard,
                                            { id: nanoId(), team, points: Number.isFinite(points) ? points : 0, sport },
                                          ],
                                        });
                                        setLeaderboardSportFilter(sport);
                                        toast.success('Leaderboard row added');
                                      }}
                                    >
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                            </div>
                          </div>

                          <div className="mt-5 grid gap-2">
                            {activeLeaderboardRows.map((row, idx) => (
                              <div
                                key={row.id}
                                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-10 text-sm font-semibold">#{idx + 1}</div>
                                  <div>
                                    <div className="text-sm font-medium">{row.team}</div>
                                    <div className="text-xs text-white/45">
                                      Points: {row.points} • {scoreViewLabel(row.sport ?? "Overall")}
                                    </div>
                                  </div>
                                </div>

                                {!isReadOnly && !isCategoryView(row.sport ?? "") ? (
                                  <div className="flex items-center gap-2">
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                          disabled={!canEditLeaderboard}
                                          title={!canEditLeaderboard ? "No permission" : undefined}
                                        >
                                          Edit
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent className="bg-black/80 border-white/15 text-white">
                                        <DialogHeader>
                                          <DialogTitle>Edit leaderboard row</DialogTitle>
                                        </DialogHeader>
                                        <div className="grid gap-4">
                                          <div className="grid gap-2">
                                            <label className="text-xs tracking-[0.18em] text-white/60">SCORE VIEW</label>
                                            <select
                                              id={`lb-sport-${row.id}`}
                                              defaultValue={row.sport ?? "Overall"}
                                              className="h-10 rounded-md border border-white/15 bg-black/30 px-3 text-sm text-white"
                                            >
                                              {leaderboardCategories.map((category) => (
                                                <option key={category} value={category} className="bg-black text-white">
                                                  {scoreViewLabel(category)}
                                                </option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="grid gap-2">
                                            <label className="text-xs tracking-[0.18em] text-white/60">TEAM</label>
                                            <Input
                                              defaultValue={row.team}
                                              id={`lb-team-${row.id}`}
                                              className="bg-black/30 border-white/15 text-white"
                                            />
                                          </div>
                                          <div className="grid gap-2">
                                            <label className="text-xs tracking-[0.18em] text-white/60">POINTS</label>
                                            <Input
                                              defaultValue={row.points}
                                              id={`lb-points-${row.id}`}
                                              type="number"
                                              className="bg-black/30 border-white/15 text-white"
                                            />
                                          </div>
                                          <div className="flex justify-end">
                                            <Button
                                              className="bg-cyan-300 text-black hover:bg-cyan-200"
                                              onClick={() => {
                                                if (!canEditLeaderboard) return;
                                                const sportEl = document.getElementById(`lb-sport-${row.id}`) as HTMLSelectElement | null;
                                                const teamEl = document.getElementById(`lb-team-${row.id}`) as HTMLInputElement | null;
                                                const ptsEl = document.getElementById(`lb-points-${row.id}`) as HTMLInputElement | null;
                                                const sport = (sportEl?.value ?? row.sport ?? "Overall") || "Overall";
                                                const team = (teamEl?.value ?? '').trim();
                                                const points = Number(ptsEl?.value ?? 0);
                                                if (!team) {
                                                  toast.error('Team is required');
                                                  return;
                                                }
                                                commitIfLeaderboardAllowed({
                                                  ...store,
                                                  leaderboard: store.leaderboard.map((x) =>
                                                    x.id === row.id
                                                      ? { ...x, team, points: Number.isFinite(points) ? points : 0, sport }
                                                      : x
                                                  ),
                                                });
                                                setLeaderboardSportFilter(sport);
                                                toast.success('Leaderboard updated');
                                              }}
                                            >
                                              Save
                                            </Button>
                                          </div>
                                        </div>
                                      </DialogContent>
                                    </Dialog>

                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                      disabled={!canEditLeaderboard}
                                      title={!canEditLeaderboard ? "No permission" : undefined}
                                      onClick={() => {
                                        commitIfLeaderboardAllowed({
                                          ...store,
                                          leaderboard: store.leaderboard.filter((x) => x.id !== row.id),
                                        });
                                        toast('Row removed');
                                      }}
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            ))}

                            {activeLeaderboardRows.length === 0 ? (
                              <div className="text-sm text-white/45">
                                {isCategoryView(activeScoreView)
                                  ? `No ${categoryViewLabel(activeScoreView)} points yet. Event scores appear here once they are applied.`
                                  : `No ${activeScoreView === "Overall" ? "overall" : activeScoreView} leaderboard rows yet.`}
                              </div>
                            ) : null}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </TabsContent>

                {/* BRACKETING */}
                <TabsContent value="bracketing" className="mt-5">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div>
                        <div data-tour-target="bracketing" className="text-lg font-semibold">Bracketing</div>
                        

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <div className="text-xs tracking-[0.18em] text-white/50">CATEGORY</div>
                          <Select
                            value={bracketCategoryScope ? bracketCategoryScope.name : "ALL"}
                            onValueChange={(v) => {
                              setBracketCategoryFilter(v);
                              const nextCategory =
                                store.settings.events.find((category) => category.name === v) ?? null;
                              if (
                                bracketSportFilter !== "ALL" &&
                                (!nextCategory ||
                                  !nextCategory.events.some((event) => event.name === bracketSportFilter))
                              ) {
                                setBracketSportFilter("ALL");
                              }
                            }}
                          >
                            <SelectTrigger className="h-9 w-full sm:w-[190px] bg-black/30 border-white/15 text-white">
                              <SelectValue placeholder="All categories" />
                            </SelectTrigger>
                            <SelectContent className="max-h-80">
                              <SelectItem value="ALL">All categories</SelectItem>
                              {store.settings.events
                                .filter((category) => category.events.length)
                                .map((category) => (
                                  <SelectItem key={category.id} value={category.name}>
                                    {category.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>

                          <div className="text-xs tracking-[0.18em] text-white/50">EVENT</div>
                          <Select
                            value={bracketEventFilter}
                            onValueChange={(v) => setBracketSportFilter(v as any)}
                          >
                            <SelectTrigger className="h-9 w-full sm:w-[220px] bg-black/30 border-white/15 text-white">
                              <SelectValue placeholder="Select event" />
                            </SelectTrigger>
                            <SelectContent className="max-h-80">
                              <SelectItem value="ALL">All events</SelectItem>
                              {store.settings.events
                                .filter(
                                  (category) =>
                                    !bracketCategoryScope || category.name === bracketCategoryScope.name,
                                )
                                .map((category) =>
                                  category.events.length ? (
                                    <SelectGroup key={category.id}>
                                      <SelectLabel>{category.name}</SelectLabel>
                                      {category.events.map((event) => (
                                        <SelectItem key={event.id} value={event.name}>
                                          {event.name}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  ) : null,
                                )}
                            </SelectContent>
                          </Select>

                          {isAdmin ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-white/20 bg-transparent text-white hover:bg-white/10"
                              onClick={() => setTab("settings")}
                            >
                              Edit events in Settings
                            </Button>
                          ) : null}
                        </div>

                        {store.settings.sports.length === 0 ? (
                          <div className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                            No events are defined yet. A bracket needs an event, so add the categories and events in
                            Settings first.
                          </div>
                        ) : null}
                      </div>
                      {!isReadOnly ? (
                      <Dialog open={isNewBracketOpen} onOpenChange={setNewBracketOpen}>
                        <DialogTrigger asChild>
                          <Button
                            className="bg-cyan-300 text-black hover:bg-cyan-200"
                            disabled={!canEditBrackets}
                            title={!canEditBrackets ? "No permission" : undefined}
                          >
                            Add bracket
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-black/80 border-white/15 text-white">
                          <DialogHeader>
                            <DialogTitle>Add bracket</DialogTitle>
                          </DialogHeader>
                          <BracketEditor
                            categories={store.settings.events}
                            onSave={(b) => {
                              commitIfBracketsAllowed({ ...store, brackets: [b, ...store.brackets] });
                              setNewBracketOpen(false);
                              toast.success("Bracket saved");
                            }}
                          />
                        </DialogContent>
                      </Dialog>
                      ) : null}
                    </div>

                    <div className="mt-5 grid gap-4">
                      {visibleBrackets.map((b) => {
                        const bracketCategory = categoryOfEvent(store.settings.events, b.sport);
                        return (
                        <div key={b.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">{b.name}</div>
                              <div className="mt-1 text-xs text-white/45">
                                Event: {b.sport} • Format: {bracketFormatLabel(b.format)}
                              </div>
                              {bracketCategory?.placements.length ? (
                                <div className="mt-1 text-xs text-white/40">
                                  {bracketCategory.placements
                                    .map((placement) => `${placement.label}: ${placement.points}`)
                                    .join(" • ")}
                                  {` • Entry: ${bracketCategory.entryPoints}`}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <Dialog
                                open={bracketToEdit === b.id}
                                onOpenChange={(open) => setBracketToEdit(open ? b.id : null)}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                    disabled={!canEditBrackets}
                                    title={!canEditBrackets ? "No permission" : undefined}
                                  >
                                    Edit teams/name
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="bg-black/80 border-white/15 text-white">
                                  <DialogHeader>
                                    <DialogTitle>Edit bracket</DialogTitle>
                                  </DialogHeader>
                                  <BracketEditor
                                    value={b}
                                    categories={store.settings.events}
                                    onSave={(next) => {
                                      commitIfBracketsAllowed({
                                        ...store,
                                        brackets: store.brackets.map((x) => (x.id === next.id ? next : x)),
                                      });
                                      setBracketToEdit(null);
                                      toast.success("Bracket updated");
                                    }}
                                  />
                                </DialogContent>
                              </Dialog>

                              <Button
                                size="sm"
                                variant="outline"
                                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                disabled={!canEditBrackets}
                                title={!canEditBrackets ? "No permission" : undefined}
                                onClick={() => {
                                  commitIfBracketsAllowed({
                                    ...store,
                                    brackets: store.brackets.filter((x) => x.id !== b.id),
                                  });
                                  toast("Bracket removed");
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>

                          {b.format === "points" ? (
                            <PointsRanking
                              bracket={b}
                              category={bracketCategory}
                              canEdit={canEditBrackets}
                              onPoints={(team, rawValue) => updateStandingPoints(b, team, rawValue)}
                            />
                          ) : (
                          <>
                          {/* Winners bracket */}
                          {b.format === "double" ? (
                            <div className="mt-4 text-xs tracking-[0.25em] text-white/55">WINNERS BRACKET</div>
                          ) : null}
                          <div className="mt-2">
                            <BracketRoundColumns
                              rounds={b.rounds}
                              section="winners"
                              bracket={b}
                              canEdit={canEditBrackets}
                              autoAdvance={bracketAutoAdvance}
                              onScore={updateBracketScore}
                              onAdvance={advanceBracketMatch}
                            />
                          </div>

                          <div className="mt-3 text-xs text-white/35">
                            {b.format === "double" ? (
                              <>
                                Tip: Losers drop into the losers bracket automatically.{" "}
                                {bracketAutoAdvance
                                  ? "Enter both scores and the higher one advances."
                                  : "Enter scores (optional), then choose the winner to advance."}{" "}
                                Ties are not allowed.
                              </>
                            ) : bracketAutoAdvance ? (
                              <>Tip: Enter scores for both teams. Higher score advances. Ties are not allowed.</>
                            ) : (
                              <>Tip: Enter scores (optional), then manually choose the winner to advance.</>
                            )}
                          </div>

                          {b.format === "double" ? (
                            <div className="mt-5">
                              <div className="text-xs tracking-[0.25em] text-white/55">LOSERS BRACKET</div>

                              {(b.losersRounds ?? []).length ? (
                                <div className="mt-2">
                                  <BracketRoundColumns
                                    rounds={b.losersRounds ?? []}
                                    section="losers"
                                    bracket={b}
                                    canEdit={canEditBrackets}
                                    autoAdvance={bracketAutoAdvance}
                                    onScore={updateBracketScore}
                                    onAdvance={advanceBracketMatch}
                                  />
                                </div>
                              ) : (
                                <div className="mt-2 text-sm text-white/45">
                                  A two-team bracket has no losers rounds; the first rematch is the grand final.
                                </div>
                              )}

                              {b.grandFinal ? (
                                <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
                                  <div className="text-xs tracking-[0.25em] text-white/55">GRAND FINAL</div>
                                  <div className="mt-3 max-w-[280px]">
                                    <BracketMatchCard
                                      match={b.grandFinal}
                                      canEdit={canEditBrackets}
                                      autoAdvance={bracketAutoAdvance}
                                      onScore={(side, rawValue) =>
                                        updateBracketScore(b, "grandFinal", 0, 0, side, rawValue)
                                      }
                                      onAdvance={(side) =>
                                        advanceBracketMatch(b, "grandFinal", 0, 0, side)
                                      }
                                    />
                                  </div>
                                  <div className="mt-2 text-[11px] text-white/35">
                                    Winners bracket champion vs. the last team standing in the losers bracket.
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          </>
                          )}
                        </div>
                        );
                      })}

                      {visibleBrackets.length === 0 ? (
                        <div className="text-sm text-white/45">
                          {bracketCategoryScope
                            ? `No brackets in ${bracketCategoryScope.name} yet.`
                            : "No brackets for this event yet."}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TabsContent>

{/* EVALUATION */}
                <TabsContent value="evaluation" className="mt-5">
                  <div className="space-y-4">
                    {(() => {
                      const evalWindow = evaluationWindow(store.evaluation);
                      const openedLabel = store.evaluation.opensAtIso
                        ? new Date(store.evaluation.opensAtIso).toLocaleString()
                        : "";
                      const closesLabel = store.evaluation.closesAtIso
                        ? new Date(store.evaluation.closesAtIso).toLocaleString()
                        : "";

                      return (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div data-tour-target="evaluation" className="text-lg font-semibold">
                                {store.evaluation.title || "Evaluation"}
                              </div>
                              <div className="mt-1 text-sm text-white/50">
                                {store.evaluation.questions.length === 0
                                  ? "No form has been built yet."
                                  : evalWindow.isOpen
                                    ? `Open now${closesLabel ? ` · closes ${closesLabel}` : ""}`
                                    : openedLabel
                                      ? `Opens ${openedLabel}`
                                      : "Closed."}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isAdmin ? (
                                <Dialog open={isFormBuilderOpen} onOpenChange={setIsFormBuilderOpen}>
                                  <DialogTrigger asChild>
                                    <Button className="bg-cyan-300 text-black hover:bg-cyan-200">Build form</Button>
                                  </DialogTrigger>
                                  <DialogContent className="bg-black/80 border-white/15 text-white">
                                    <DialogHeader><DialogTitle>Evaluation form</DialogTitle></DialogHeader>
                                    <EvaluationBuilder
                                      form={store.evaluation}
                                      onSave={(next) => {
                                        commit({ ...store, evaluation: next });
                                        setIsFormBuilderOpen(false);
                                        setEvalReloadTick((tick) => tick + 1);
                                        toast.success("Evaluation form saved");
                                      }}
                                    />
                                  </DialogContent>
                                </Dialog>
                              ) : null}
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                disabled={isEvalLoading}
                                onClick={() => setEvalReloadTick((tick) => tick + 1)}
                              >
                                {isEvalLoading ? "Loading…" : "Refresh"}
                              </Button>
                            </div>
                          </div>

                          {store.evaluation.description ? (
                            <div className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/25 p-5 text-sm leading-relaxed text-white/65">
                              {store.evaluation.description}
                            </div>
                          ) : null}

                          {evalError ? (
                            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-white/70">
                              {evalError}
                              <div className="mt-1 text-white/45">
                                If the evaluation tables are missing, run supabase/evaluation.sql in the Supabase SQL editor.
                              </div>
                            </div>
                          ) : null}

                          {isAdmin ? (
                            <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-base font-semibold">Ratings</div>
                                <div className="text-xs text-white/45">
                                  {evalResults?.responses.length ?? 0}{" "}
                                  {evalResults?.responses.length === 1 ? "response" : "responses"} ·
                                  refreshes every 20s
                                </div>
                              </div>

                              {evalResults && evalResults.responses.length > 0 ? (
                                <div className="mt-4 space-y-3">
                                  <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-sm">
                                    Overall average:{" "}
                                    <span className="font-semibold text-cyan-200">
                                      {evalResults.overall.toFixed(1)} / 5
                                    </span>
                                  </div>
                                  {evalResults.perQuestion.map((result) => (
                                    <div key={result.id} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                      <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="min-w-0 break-words">{result.label}</span>
                                        <span className="shrink-0 text-white/60">
                                          {result.count ? `${result.average.toFixed(1)} / 5` : "no ratings"} · {result.count}
                                        </span>
                                      </div>
                                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                                        <div
                                          className="h-full rounded-full bg-cyan-300"
                                          style={{ width: `${(result.average / 5) * 100}%` }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-3 text-sm text-white/50">
                                  {evalError ? "Could not load responses." : "No responses yet."}
                                </div>
                              )}

                              {evalResults && evalResults.responses.some((r) => r.comment) ? (
                                <div className="mt-4 space-y-2">
                                  <div className="text-xs tracking-[0.18em] text-white/60">COMMENTS</div>
                                  {evalResults.responses
                                    .filter((response) => response.comment)
                                    .map((response) => (
                                      <div key={response.id} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                        <div className="whitespace-pre-wrap text-sm text-white/75">{response.comment}</div>
                                        <div className="mt-1 text-xs text-white/40">
                                          {response.username || "anonymous"} · {formatPosted(response.submittedAtIso)}
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {!isGuest ? (
                            evalWindow.isOpen ? (
                              <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                                <div className="text-base font-semibold">Your response</div>
                                <div className="mt-1 text-sm text-white/50">
                                  Signed in as {session.username || role}. Rate each question from 1 (worst) to 5 (best).
                                </div>

                                <div className="mt-4 space-y-4">
                                  {store.evaluation.questions.map((question, index) => (
                                    <div key={question.id} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                      <div className="text-sm">
                                        {index + 1}. {question.label}
                                      </div>
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {RATING_SCALE.map((value) => {
                                          const selected = evalAnswers[question.id] === value;
                                          return (
                                            <Button
                                              key={value}
                                              size="sm"
                                              variant="outline"
                                              className={
                                                selected
                                                  ? "border-cyan-300 bg-cyan-300 text-black hover:bg-cyan-200"
                                                  : "border-white/20 bg-transparent text-white hover:bg-white/10"
                                              }
                                              onClick={() =>
                                                setEvalAnswers((prev) => ({ ...prev, [question.id]: value }))
                                              }
                                            >
                                              {value}
                                            </Button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}

                                  <div className="grid gap-2">
                                    <label className="text-xs tracking-[0.18em] text-white/60">COMMENTS (OPTIONAL)</label>
                                    <Textarea
                                      value={evalComment}
                                      rows={3}
                                      className="bg-black/30 border-white/15 text-white placeholder:text-white/35"
                                      placeholder="Anything else the organisers should know?"
                                      onChange={(e) => setEvalComment(e.target.value)}
                                    />
                                  </div>

                                  <div className="flex justify-end">
                                    <Button
                                      className="bg-cyan-300 text-black hover:bg-cyan-200"
                                      disabled={isEvalSubmitting}
                                      onClick={async () => {
                                        setIsEvalSubmitting(true);
                                        try {
                                          await submitEvaluation(
                                            store.evaluation,
                                            session.username ?? role,
                                            evalAnswers,
                                            evalComment,
                                          );
                                          setEvalAnswers({});
                                          setEvalComment("");
                                          setEvalReloadTick((tick) => tick + 1);
                                          toast.success("Thanks! Your response was recorded.");
                                        } catch (error) {
                                          toast.error(error instanceof Error ? error.message : "Could not submit.");
                                        } finally {
                                          setIsEvalSubmitting(false);
                                        }
                                      }}
                                    >
                                      {isEvalSubmitting ? "Submitting…" : "Submit response"}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-white/10 bg-black/25 p-6 text-sm text-white/50">
                                {store.evaluation.questions.length === 0
                                  ? "The evaluation form has not been built yet."
                                  : `Responses are ${
                                      store.evaluation.opensAtIso && !evalWindow.isOpen && evalWindow.opensAt > Date.now()
                                        ? "not open yet"
                                        : "closed"
                                    }.`}
                              </div>
                            )
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </TabsContent>

                {/* PROFILE (every signed-in account) */}
                {role !== "guest" ? (
                <TabsContent value="profile" className="mt-5">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                      <div className="flex flex-wrap items-center gap-5">
                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-white/15 bg-white/5">
                          {avatarPath ? (
                            <img
                              src={`${avatarImageUrl(avatarPath)}?v=${avatarStamp}`}
                              alt={`${session.username ?? role} profile picture`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-2xl font-semibold uppercase text-white/45">
                              {(session.username ?? role).slice(0, 2)}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="text-lg font-semibold break-all">{session.username ?? role}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/55">
                            <Badge className="border border-white/15 bg-white/10 capitalize text-white hover:bg-white/10">
                              {role}
                            </Badge>
                            <span>
                              {myPostsTotal} {myPostsTotal === 1 ? "post" : "posts"} in the feed
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={isAvatarBusy}
                          className="block max-w-full text-sm text-white file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-300 file:px-4 file:py-2 file:text-black file:hover:bg-cyan-200 disabled:opacity-50"
                          onChange={(event) => {
                            handleAvatarPick(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                        {avatarPath ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-white/20 bg-transparent text-white hover:bg-white/10"
                            disabled={isAvatarBusy}
                            onClick={handleAvatarRemove}
                          >
                            Remove picture
                          </Button>
                        ) : null}
                      </div>
                      <div className="mt-2 text-xs text-white/40">
                        {isAvatarBusy
                          ? "Saving your picture…"
                          : "Cropped to a square and resized before upload. The picture is tied to your username, so it follows you to another device."}
                      </div>

                      {profileError ? (
                        <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
                          {profileError}
                          <div className="mt-1 text-white/45">
                            If the profile table is missing, run supabase/profile.sql in the Supabase SQL editor.
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-lg font-semibold">My posts</div>
                          <div className="mt-1 text-sm text-white/50">
                            {isMyPostsLoading
                              ? "Loading…"
                              : `Showing ${myPosts.length} of ${myPostsTotal} · ${FEED_PAGE_SIZE} posts per page`}
                          </div>
                        </div>
                        {!isGuest ? (
                          <Dialog open={isProfileComposerOpen} onOpenChange={setProfileComposerOpen}>
                            <DialogTrigger asChild>
                              <Button
                                className="shrink-0 bg-cyan-300 text-black hover:bg-cyan-200"
                                data-tour-target="profile-post"
                              >
                                Add post
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="rcess-composer-dialog border-white/15 bg-black/80 text-white">
                              <DialogHeader className="shrink-0"><DialogTitle>Add post</DialogTitle></DialogHeader>
                              <FeedComposer
                                postedBy={session.username ?? role}
                                onPosted={() => {
                                  setProfileComposerOpen(false);
                                  setMyPostsTick((tick) => tick + 1);
                                  setFeedReloadTick((tick) => tick + 1);
                                }}
                              />
                            </DialogContent>
                          </Dialog>
                        ) : null}
                      </div>

                      {myPostsError ? (
                        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
                          {myPostsError}
                        </div>
                      ) : null}

                      {myPosts.length === 0 && !myPostsError && !isMyPostsLoading ? (
                        <div className="mt-4 text-sm text-white/50">
                          You have not posted anything yet. Press Add post above to share a picture, a caption, or
                          both — it lands here and in News Feed at the same time.
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3">
                          {myPosts.map((post) => (
                            <button
                              key={post.id}
                              type="button"
                              onClick={() => setOpenFeedPost(post)}
                              onContextMenu={(event) => event.preventDefault()}
                              aria-label="Open post"
                              className="rcess-feed-post flex w-full cursor-zoom-in items-start gap-4 rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:border-cyan-300/40"
                            >
                              {post.imagePaths.length ? (
                                <img
                                  src={feedImageUrl(post.imagePaths[0])}
                                  alt={post.caption || `Picture from ${post.postedBy}`}
                                  loading="lazy"
                                  draggable={false}
                                  className="rcess-feed-photo h-20 w-20 shrink-0 rounded-lg border border-white/10 object-cover"
                                />
                              ) : (
                                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[10px] uppercase tracking-[0.14em] text-white/40">
                                  Text
                                </div>
                              )}

                              <div className="min-w-0 self-center text-xs text-white/40">
                                {formatPosted(post.postedAtIso)} ·{" "}
                                {post.imagePaths.length === 0
                                  ? "Text post"
                                  : `${post.imagePaths.length} ${post.imagePaths.length === 1 ? "picture" : "pictures"}`}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {myPosts.length < myPostsTotal ? (
                        <Button
                          variant="outline"
                          className="mt-4 w-full border-white/20 bg-transparent text-white hover:bg-white/10"
                          disabled={isMyPostsLoading}
                          onClick={() => setMyPostsLimit((limit) => limit + FEED_PAGE_SIZE)}
                        >
                          {isMyPostsLoading
                            ? "Loading…"
                            : `Load the next ${Math.min(FEED_PAGE_SIZE, myPostsTotal - myPosts.length)} ${
                                myPostsTotal - myPosts.length === 1 ? "post" : "posts"
                              }`}
                        </Button>
                      ) : null}
                    </div>

                  </div>
                </TabsContent>
                ) : null}

                {/* CHANGE PASSWORD (every signed-in account) */}
                {role !== "guest" ? (
                <TabsContent value="password" className="mt-5">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                      <div className="text-lg font-semibold">Change password</div>
                      <div className="mt-1 text-sm text-white/55">
                        Enter the password you were given first, then the new one twice. Your next sign-in uses the new password.
                      </div>

                      <div className="mt-5 grid max-w-md gap-4">
                        <div className="grid gap-2">
                          <label className="text-xs tracking-[0.18em] text-white/60">CURRENT PASSWORD</label>
                          <Input
                            type="password"
                            autoComplete="current-password"
                            value={passwordForm.current}
                            onChange={(event) =>
                              setPasswordForm((form) => ({ ...form, current: event.target.value }))
                            }
                            className="border-white/15 bg-black/30 text-white placeholder:text-white/35"
                          />
                        </div>

                        <div className="grid gap-2">
                          <label className="text-xs tracking-[0.18em] text-white/60">NEW PASSWORD</label>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder="At least 6 characters"
                            value={passwordForm.next}
                            onChange={(event) =>
                              setPasswordForm((form) => ({ ...form, next: event.target.value }))
                            }
                            className="border-white/15 bg-black/30 text-white placeholder:text-white/35"
                          />
                        </div>

                        <div className="grid gap-2">
                          <label className="text-xs tracking-[0.18em] text-white/60">RE-ENTER NEW PASSWORD</label>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            value={passwordForm.confirm}
                            onChange={(event) =>
                              setPasswordForm((form) => ({ ...form, confirm: event.target.value }))
                            }
                            className="border-white/15 bg-black/30 text-white placeholder:text-white/35"
                          />
                        </div>

                        <div className="flex justify-end">
                          <Button
                            className="bg-cyan-300 text-black hover:bg-cyan-200"
                            disabled={isChangingPassword}
                            onClick={handleChangePassword}
                          >
                            {isChangingPassword ? "Changing…" : "Change password"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>
                ) : null}

                {/* SETTINGS (admin only) */}
                {isAdmin ? (
                <TabsContent value="settings" className="mt-5">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-5 md:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-lg font-semibold">Countdown Settings</div>
                        <div className="mt-2 text-sm text-white/55">
                          Change the countdown target time, or close the countdown page (redirects to login).
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4">
                      <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-4">
                        <div className="text-sm font-medium">Permissions</div>
                        <div className="mt-1 text-xs text-white/45">
                          Choose which roles can edit each module. Only admins can change these rules.
                        </div>

                        <div className="mt-4 grid gap-4">
                          {([
                            { key: "newsEditors", label: "NEWS" },
                            { key: "summitEditors", label: "EMERGENCY HOTLINE" },
                            { key: "leaderboardEditors", label: "LEADERBOARD" },
                            { key: "bracketEditors", label: "BRACKETING" },
                            { key: "scheduleEditors", label: "SCHEDULE" },
                            { key: "mapEditors", label: "MAP" },
                            { key: "settingsEditors", label: "SETTINGS" },
                          ] as const).map((perm) => (
                            <div key={perm.key} className="grid gap-2">
                              <div className="text-xs tracking-[0.18em] text-white/60">{perm.label} EDITORS</div>
                              <div className="flex flex-wrap gap-3">
                                {(["admin", "staff", "sports"] as const).map((r) => (
                                  <label key={r} className="flex items-center gap-2 text-sm text-white/75">
                                    <Checkbox
                                      checked={(store.settings.permissions as any)[perm.key]?.includes(r)}
                                      disabled={!isAdmin}
                                      onCheckedChange={(v) => {
                                        if (!isAdmin) return;
                                        const current: string[] = (store.settings.permissions as any)[perm.key] ?? [];
                                        const next = new Set(current);
                                        if (v) next.add(r);
                                        else next.delete(r);
                                        setStore((prev) => ({
                                          ...prev,
                                          settings: {
                                            ...prev.settings,
                                            permissions: {
                                              ...(prev.settings.permissions as any),
                                              [perm.key]: Array.from(next),
                                            },
                                          },
                                        }));
                                      }}
                                    />
                                    <span className="capitalize">{r}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-4 rounded-xl border border-white/10 bg-black/30 px-4 py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">First-login Tutorial Guide</div>
                            <div className="mt-1 text-xs leading-relaxed text-white/50">
                              Turn the automatic first-login guide on or off for every signed-in account. Each account gets the steps for the tabs it can reach, including Account and, for administrators, Settings.
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center">
                            <Switch
                              checked={viewerTutorialEnabled}
                              disabled={!isAdmin}
                              aria-label="Enable first-login tutorial guide"
                              onCheckedChange={(checked) => {
                                if (!isAdmin) {
                                  toast("Admin only");
                                  return;
                                }
                                const enabled = Boolean(checked);
                                setViewerTutorialEnabled(enabled);
                                try {
                                  window.localStorage.setItem("rcess-viewer-tour-enabled", String(enabled));
                                  if (!enabled) {
                                    setViewerTourOpen(false);
                                    setMobileNavOpen(false);
                                  }
                                  toast.success(`Tutorial guide turned ${enabled ? "on" : "off"}.`);
                                } catch {
                                  toast.error("Could not save the tutorial setting in this browser.");
                                }
                              }}
                            />
                          </div>
                        </div>

                        <div className="border-t border-white/10 pt-4">
                          <div className="text-sm font-medium">Reset tutorial progress</div>
                          <div className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
                            Reset the first-login guide progress for every account remembered in this browser. The guide will appear again the next time each account logs in using this browser, provided the tutorial is turned on.
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-3 w-full border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20 sm:w-fit"
                            disabled={!isAdmin}
                            onClick={() => {
                              if (!isAdmin) {
                                toast("Admin only");
                                return;
                              }
                              try {
                                const keysToRemove: string[] = [];
                                for (let i = 0; i < window.localStorage.length; i += 1) {
                                  const key = window.localStorage.key(i);
                                  if (key?.startsWith("rcess-viewer-tour-complete:")) {
                                    keysToRemove.push(key);
                                  }
                                }
                                keysToRemove.forEach((key) => window.localStorage.removeItem(key));
                                toast.success("Tutorial progress reset. It will appear on the next login for each account if enabled.");
                              } catch {
                                toast.error("Could not reset tutorial progress in this browser.");
                              }
                            }}
                          >
                            Reset tutorial progress
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-4">
                        <label className="text-xs tracking-[0.18em] text-white/60">TARGET ISO</label>
                        <div className="text-xs leading-relaxed text-white/45">
                          Set the countdown target date and time. Use ISO 8601 format, for example: 2026-08-01T00:00:00+08:00.
                        </div>
                        <Input
                          value={store.settings.countdownIso}
                          onChange={(e) =>
                            setStore((prev) => ({
                              ...prev,
                              settings: { ...prev.settings, countdownIso: e.target.value },
                            }))
                          }
                          disabled={!canEditSettings}
                          className="w-full bg-black/30 border-white/15 text-white disabled:opacity-60"
                          placeholder="2026-08-01T00:00:00+08:00"
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                        <div>
                          <div className="text-sm font-medium">Close countdown page</div>
                          <div className="text-xs text-white/45">
                            When enabled, opening the countdown page redirects to login.
                          </div>
                        </div>
                        <Switch
                          checked={store.settings.countdownClosed}
                          onCheckedChange={(v) =>
                            setStore((prev) => ({
                              ...prev,
                              settings: { ...prev.settings, countdownClosed: Boolean(v) },
                            }))
                          }
                          disabled={!canEditSettings}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                        <div>
                          <div className="text-sm font-medium">Bracket auto-advance</div>
                          <div className="text-xs text-white/45">
                            Auto: winner is decided by scores. Manual: admin selects who advances.
                          </div>
                        </div>
                        <Switch
                          checked={store.settings.bracketAutoAdvance}
                          onCheckedChange={(v) =>
                            setStore((prev) => ({
                              ...prev,
                              settings: { ...prev.settings, bracketAutoAdvance: Boolean(v) },
                            }))
                          }
                          disabled={!canEditSettings}
                        />
                      </div>

                      <div data-tour-target="events" className="grid gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">Events and points</div>
                            <div className="mt-1 text-xs leading-relaxed text-white/45">
                              The list every other tab reads: categories such as Sports or Academics, the events
                              inside them, and the one award table each category pays. Every event in a category —
                              Basketball, Volleyball, and the rest — scores the same points. Saving here updates
                              Bracketing and the Leaderboard straight away.
                            </div>
                          </div>
                          <Dialog
                            open={isEventsEditorOpen}
                            onOpenChange={(open) => {
                              setEventsEditorOpen(open);
                              if (!open) setEventsEditorFocus(null);
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button
                                className="shrink-0 bg-cyan-300 text-black hover:bg-cyan-200"
                                disabled={!canEditSettings}
                                title={!canEditSettings ? "No permission" : undefined}
                                onClick={() => setEventsEditorFocus(null)}
                              >
                                Edit events
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="rcess-scroll max-h-[90vh] overflow-y-auto border-white/15 bg-black/85 text-white">
                              <DialogHeader>
                                <DialogTitle>Events and points</DialogTitle>
                              </DialogHeader>
                              <EventsEditor
                                value={store.settings.events}
                                focusId={eventsEditorFocus}
                                onSave={(events) => {
                                  commitIfAdmin(applyCatalogue(store, events));
                                  setEventsEditorOpen(false);
                                  toast.success("Events saved");
                                }}
                              />
                            </DialogContent>
                          </Dialog>
                        </div>

                        <div className="grid gap-2">
                          {store.settings.events.map((category) => (
                            <div key={category.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="text-sm font-medium text-white">{category.name}</div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                                  disabled={!canEditSettings}
                                  title={!canEditSettings ? "No permission" : undefined}
                                  onClick={() => {
                                    setEventsEditorFocus(category.id);
                                    setEventsEditorOpen(true);
                                  }}
                                >
                                  Edit {category.name}
                                </Button>
                              </div>
                              <div className="mt-2 text-xs leading-relaxed text-white/60">
                                {category.placements.length
                                  ? category.placements
                                      .map((placement) => `${placement.label} ${placement.points}`)
                                      .join(", ")
                                  : "no placements yet"}
                                {", entry " + category.entryPoints + ", without entry " + category.noEntryPoints}
                              </div>
                              {category.events.length ? (
                                <div className="mt-1 text-xs leading-relaxed text-white/45">
                                  Events: {category.events.map((event) => event.name).join(", ")}
                                </div>
                              ) : (
                                <div className="mt-1 text-xs text-white/35">No events in this category yet.</div>
                              )}
                            </div>
                          ))}
                          {store.settings.events.length === 0 ? (
                            <div className="text-xs text-white/45">
                              Nothing defined yet — open Edit events to add your first category.
                            </div>
                          ) : null}
                        </div>

                        {eventsLocalOnly ? (
                          <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                            The catalogue saved on this browser only. Supabase has no events column yet, so other
                            devices will not see it until you run supabase/events.sql in the SQL editor.
                          </div>
                        ) : null}
                      </div>

                      <div className="grid gap-4 rounded-xl border border-white/10 bg-black/30 px-4 py-4">
                        <div>
                          <div className="text-sm font-medium">Evaluation window</div>
                          <div className="mt-1 text-xs leading-relaxed text-white/45">
                            The dates viewers can rate the event. Leave both empty to keep the form open
                            whenever it has questions. Saved with the button below.
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="grid gap-2">
                            <label className="text-xs tracking-[0.18em] text-white/60">OPENS</label>
                            <Input
                              type="datetime-local"
                              value={toDateTimeInput(store.evaluation.opensAtIso)}
                              onChange={(e) =>
                                setStore((prev) => ({
                                  ...prev,
                                  evaluation: { ...prev.evaluation, opensAtIso: fromDateTimeInput(e.target.value) },
                                }))
                              }
                              disabled={!canEditSettings}
                              className="bg-black/30 border-white/15 text-white disabled:opacity-60"
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-xs tracking-[0.18em] text-white/60">CLOSES</label>
                            <Input
                              type="datetime-local"
                              value={toDateTimeInput(store.evaluation.closesAtIso)}
                              onChange={(e) =>
                                setStore((prev) => ({
                                  ...prev,
                                  evaluation: { ...prev.evaluation, closesAtIso: fromDateTimeInput(e.target.value) },
                                }))
                              }
                              disabled={!canEditSettings}
                              className="bg-black/30 border-white/15 text-white disabled:opacity-60"
                            />
                          </div>
                        </div>

                        <div className="text-xs text-white/45">
                          {(() => {
                            const evalWindow = evaluationWindow(store.evaluation);
                            if (store.evaluation.questions.length === 0) {
                              return "No questions yet — build the form in the Evaluation tab.";
                            }
                            return evalWindow.isOpen
                              ? "Preview: open now."
                              : `Preview: ${
                                  Number.isFinite(evalWindow.opensAt) && evalWindow.opensAt > Date.now()
                                    ? `opens ${new Date(evalWindow.opensAt).toLocaleString()}`
                                    : "closed"
                                }.`;
                          })()}
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button
                          className="bg-cyan-300 text-black hover:bg-cyan-200"
                          disabled={!canEditSettings}
                          title={!canEditSettings ? "No permission" : undefined}
                          onClick={() => {
                            if (!canEditSettings) {
                              toast("No permission to edit Settings");
                              return;
                            }
                            commit(store);
                            toast.success("Settings saved");
                          }}
                        >
                          Save settings
                        </Button>
                      </div>
                    </div>
                  </div>
                </TabsContent>
                ) : null}
              </Tabs>

              {/* Opening a post is how a viewer reaches their own delete. It sits
                  outside the tab panels because an inactive panel is unmounted, and
                  the feed list and the profile list both open the same post. */}
              <Dialog
                open={Boolean(openFeedPost)}
                onOpenChange={(open) => {
                  if (!open) {
                    setOpenFeedPost(null);
                    setFeedConfirmId(null);
                  }
                }}
              >
                <DialogContent
                  onContextMenu={(event) => event.preventDefault()}
                  className="rcess-feed-post rcess-scroll max-h-[90vh] overflow-y-auto border-white/15 bg-black/85 text-white"
                >
                  <DialogHeader><DialogTitle>Feed post</DialogTitle></DialogHeader>
                  {openFeedPost ? (
                    <div className="grid gap-3">
                      {openFeedPost.imagePaths.map((path) => (
                        <div
                          key={path}
                          onContextMenu={(event) => event.preventDefault()}
                          className="rounded-xl"
                        >
                          <img
                            src={feedImageUrl(path)}
                            alt={openFeedPost.caption || "Feed picture"}
                            draggable={false}
                            className="rcess-feed-photo max-h-[60vh] w-full rounded-xl border border-white/10 object-contain"
                          />
                        </div>
                      ))}
                      {openFeedPost.caption ? (
                        <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{openFeedPost.caption}</div>
                      ) : null}
                      <div className="text-xs text-white/40">
                        Posted by {openFeedPost.postedBy || "unknown"} · {formatPosted(openFeedPost.postedAtIso)}
                      </div>
                      {isAdmin || (session.username && openFeedPost.postedBy === session.username) ? (
                        <div className="flex justify-end">
                          <FeedDeleteButton
                            post={openFeedPost}
                            label="Delete post"
                            confirming={feedConfirmId === openFeedPost.id}
                            busy={isFeedDeleting}
                            onAsk={(target) => setFeedConfirmId(target.id)}
                            onCancel={() => setFeedConfirmId(null)}
                            onConfirm={handleFeedDelete}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </DialogContent>
              </Dialog>

              <Dialog
                open={Boolean(downloadFeedPost)}
                onOpenChange={(open) => {
                  if (!open) setDownloadFeedPost(null);
                }}
              >
                <DialogContent className="rcess-scroll max-h-[90vh] overflow-y-auto border-white/15 bg-black/85 text-white">
                  <DialogHeader><DialogTitle>Download picture</DialogTitle></DialogHeader>
                  {downloadFeedPost ? (
                    <div className="grid gap-3">
                      <div className="text-xs leading-relaxed text-white/45">
                        Choose the picture you want to save. This post has{" "}
                        {downloadFeedPost.imagePaths.length}{" "}
                        {downloadFeedPost.imagePaths.length === 1 ? "picture" : "pictures"}.
                      </div>
                      <div
                        className={
                          downloadFeedPost.imagePaths.length > 1
                            ? "grid gap-3 sm:grid-cols-2"
                            : ""
                        }
                      >
                        {downloadFeedPost.imagePaths.map((path, index) => {
                          const busy = downloadingFeedPath === path;

                          return (
                            <button
                              key={path}
                              type="button"
                              disabled={Boolean(downloadingFeedPath)}
                              onClick={() => handleFeedDownload(downloadFeedPost, path)}
                              className="group overflow-hidden rounded-xl border border-white/10 bg-black/25 text-left transition hover:border-cyan-300/50 disabled:cursor-wait disabled:opacity-60"
                              aria-label={`Download picture ${index + 1}`}
                            >
                              <img
                                src={feedImageUrl(path)}
                                alt={`Picture ${index + 1}`}
                                loading="lazy"
                                className="max-h-56 w-full object-contain"
                              />
                              <span className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-xs text-white/70 group-hover:text-cyan-100">
                                <span>{busy ? "Downloading…" : `Picture ${index + 1}`}</span>
                                <Download className="h-4 w-4" />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </DialogContent>
              </Dialog>
            </div>

            <div className="rcess-tab" aria-hidden />
          </Card>
        </div>

        
      </div>

      {viewerTourOpen ? (
        <div className="pointer-events-none fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="RCESS first-visit guide">
          <div className="pointer-events-none absolute inset-0 bg-black/65" />
          {viewerTourRect ? (
            <div
              aria-hidden="true"
              className="pointer-events-none fixed rounded-xl border-2 border-cyan-300 shadow-[0_0_0_4px_rgba(34,211,238,0.16),0_0_24px_rgba(34,211,238,0.38)] transition-all duration-200"
              style={{
                top: viewerTourRect.top,
                left: viewerTourRect.left,
                width: viewerTourRect.width,
                height: viewerTourRect.height,
              }}
            />
          ) : null}
          <div
            className="pointer-events-auto fixed z-[102] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[300px] overflow-y-auto rounded-xl border border-cyan-300/35 bg-[#050824] p-3 text-white shadow-2xl sm:max-w-[360px] sm:rounded-2xl sm:p-5"
            style={viewerTourRect ? { top: viewerTourRect.tipTop, left: viewerTourRect.tipLeft } : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-200 sm:text-[10px] sm:tracking-[0.22em]">First visit guide</div>
              <div className="text-xs text-white/45">{viewerTourStep + 1} of {viewerTourSteps.length}</div>
            </div>
            <h2 className="mt-1.5 text-base font-semibold sm:mt-2 sm:text-lg">{viewerTourSteps[viewerTourStep]?.title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-white/70 sm:mt-2 sm:text-sm">{viewerTourSteps[viewerTourStep]?.description}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 sm:mt-5 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-2 text-xs text-white/65 hover:bg-white/10 hover:text-white sm:h-9 sm:px-3 sm:text-sm"
                onClick={() => {
                  try {
                    window.localStorage.setItem(`rcess-viewer-tour-complete:${(session.username ?? "viewer").toLowerCase()}`, "true");
                  } catch { /* The tour can still be dismissed for this session. */ }
                  setViewerTourOpen(false);
                  setMobileNavOpen(false);
                }}
              >
                Skip tour
              </Button>
              <div className="flex items-center gap-2">
                {viewerTourStep > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-2 text-xs border-white/20 bg-transparent text-white hover:bg-white/10 sm:h-9 sm:px-3 sm:text-sm"
                    onClick={() => moveViewerTourToStep(Math.max(0, viewerTourStep - 1))}
                  >
                    Back
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="h-8 px-3 text-xs bg-cyan-300 text-black hover:bg-cyan-200 sm:h-9 sm:px-4 sm:text-sm"
                  onClick={() => {
                    if (viewerTourStep >= viewerTourSteps.length - 1) {
                      try {
                        window.localStorage.setItem(`rcess-viewer-tour-complete:${(session.username ?? "viewer").toLowerCase()}`, "true");
                      } catch { /* The tour can still be dismissed for this session. */ }
                      setViewerTourOpen(false);
                      setMobileNavOpen(false);
                    } else {
                      moveViewerTourToStep(Math.min(viewerTourSteps.length - 1, viewerTourStep + 1));
                    }
                  }}
                >
                  {viewerTourStep >= viewerTourSteps.length - 1 ? "Finish tour" : "Next"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
