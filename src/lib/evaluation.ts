import { supabase } from "@/lib/supabase";
import { nanoId } from "@/lib/store";
import type { EvaluationForm } from "@/lib/store";

// Answers are written straight to Supabase instead of travelling in the store
// blob: every user submits their own row, and a browser holding a stale store
// would otherwise delete other people's responses when it saves.
const TABLE = "evaluation_responses";

export const RATING_SCALE = [1, 2, 3, 4, 5];

export type EvaluationAnswers = Record<string, number>;

export type EvaluationResponse = {
  id: string;
  username: string;
  answers: EvaluationAnswers;
  comment: string;
  submittedAtIso: string;
};

export type QuestionResult = {
  id: string;
  label: string;
  average: number;
  count: number;
};

export type EvaluationResults = {
  responses: EvaluationResponse[];
  perQuestion: QuestionResult[];
  overall: number;
};

// Empty window fields mean the admin did not schedule anything, so the form is
// always available.
export function evaluationWindow(form: EvaluationForm, now = new Date()) {
  const opensAt = form.opensAtIso ? new Date(form.opensAtIso).getTime() : NaN;
  const closesAt = form.closesAtIso ? new Date(form.closesAtIso).getTime() : NaN;
  const time = now.getTime();

  return {
    isOpen:
      form.questions.length > 0 &&
      (Number.isNaN(opensAt) || time >= opensAt) &&
      (Number.isNaN(closesAt) || time <= closesAt),
    opensAt,
    closesAt,
  };
}

export async function submitEvaluation(
  form: EvaluationForm,
  username: string,
  answers: EvaluationAnswers,
  comment: string,
): Promise<void> {
  const missing = form.questions.filter((q) => !answers[q.id]);
  if (missing.length) {
    throw new Error("Answer every question before submitting.");
  }

  const { error } = await supabase.from(TABLE).insert({
    id: nanoId(),
    username,
    answers,
    comment: comment.trim(),
    submitted_at_iso: new Date().toISOString(),
  });

  if (error) throw error;
}

export async function fetchEvaluationResults(
  form: EvaluationForm,
): Promise<EvaluationResults> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, username, answers, comment, submitted_at_iso")
    .order("submitted_at_iso", { ascending: false });

  if (error) throw error;

  const responses: EvaluationResponse[] = (data ?? []).map((row: any) => ({
    id: String(row.id),
    username: String(row.username ?? ""),
    answers: (row.answers ?? {}) as EvaluationAnswers,
    comment: String(row.comment ?? ""),
    submittedAtIso: String(row.submitted_at_iso ?? ""),
  }));

  const perQuestion: QuestionResult[] = form.questions.map((question) => {
    const ratings = responses
      .map((response) => Number(response.answers[question.id]))
      .filter((rating) => Number.isFinite(rating) && rating > 0);

    const total = ratings.reduce((sum, rating) => sum + rating, 0);

    return {
      id: question.id,
      label: question.label,
      average: ratings.length ? total / ratings.length : 0,
      count: ratings.length,
    };
  });

  const rated = perQuestion.filter((result) => result.count > 0);
  const overall = rated.length
    ? rated.reduce((sum, result) => sum + result.average, 0) / rated.length
    : 0;

  return { responses, perQuestion, overall };
}
