import { createHash } from "crypto";
import { admin, adminDb } from "@/lib/firebase/admin";
import type { AuthenticatedUser } from "@/lib/firebase/auth-admin";

export type AiTaskType =
  | "chat"
  | "extract"
  | "generate"
  | "revise_section"
  | "revise_document";

export type AiProvider = "gemini" | "groq" | "9router";

export class AiQuotaError extends Error {
  status = 429;

  constructor(message: string) {
    super(message);
    this.name = "AiQuotaError";
  }
}

type DedupeState =
  | { status: "completed"; response: Record<string, unknown> }
  | { status: "processing" }
  | { status: "started" };

const todayKey = () => new Date().toISOString().slice(0, 10);

function readIntEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeProvider(value: string | undefined, fallback: AiProvider): AiProvider {
  const normalized = value?.toLowerCase();

  if (normalized === "gemini" || normalized === "groq" || normalized === "9router") {
    return normalized;
  }

  return fallback;
}

function normalizeFallbackProvider(value: string | undefined): AiProvider | "none" | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "none" || normalized === "off" || normalized === "false") {
    return "none";
  }

  if (normalized === "gemini" || normalized === "groq" || normalized === "9router") {
    return normalized;
  }

  return null;
}

function getTaskEnvPrefix(task: AiTaskType) {
  if (task === "revise_section") return "REVISE_SECTION";
  if (task === "revise_document") return "REVISE_DOCUMENT";
  return task.toUpperCase();
}

function getDefaultProvider(task: AiTaskType): AiProvider {
  if (task === "generate" || task === "revise_document") {
    return normalizeProvider(process.env.GENERATE_AI_PROVIDER || process.env.AI_PROVIDER, "gemini");
  }

  if (task === "revise_section") {
    return normalizeProvider(process.env.REVISE_AI_PROVIDER || process.env.AI_PROVIDER, "gemini");
  }

  if (task === "chat") {
    return normalizeProvider(process.env.CHAT_AI_PROVIDER || process.env.AI_PROVIDER, "gemini");
  }

  return normalizeProvider(process.env.GENERATE_AI_PROVIDER || process.env.AI_PROVIDER, "gemini");
}

export function getAiProviderOrder(task: AiTaskType): AiProvider[] {
  const prefix = getTaskEnvPrefix(task);
  const primary = normalizeProvider(
    process.env[`AI_${prefix}_PROVIDER`] ||
      process.env[`${prefix}_AI_PROVIDER`] ||
      process.env.AI_PROVIDER,
    getDefaultProvider(task)
  );
  const taskFallback = normalizeFallbackProvider(
    process.env[`AI_${prefix}_FALLBACK_PROVIDER`] ||
      process.env[`${prefix}_AI_FALLBACK_PROVIDER`]
  );
  const globalFallback = normalizeFallbackProvider(process.env.AI_FALLBACK_PROVIDER);
  const fallback = taskFallback || globalFallback;

  if (!fallback || fallback === "none" || fallback === primary) {
    return [primary];
  }

  return [primary, fallback];
}

export function getAiModel(task: AiTaskType, provider: AiProvider) {
  const prefix = getTaskEnvPrefix(task);
  const generic = process.env[`AI_${prefix}_MODEL`];

  if (generic) {
    return generic;
  }

  if (provider === "gemini") {
    if (task === "chat") return process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
    if (task === "extract") return process.env.GEMINI_EXTRACT_MODEL || process.env.GEMINI_GENERATE_MODEL || "gemini-2.5-flash";
    if (task === "revise_section") return process.env.GEMINI_REVISE_SECTION_MODEL || process.env.GEMINI_REVISE_MODEL || "gemini-2.5-flash";
    if (task === "revise_document") return process.env.GEMINI_REVISE_DOCUMENT_MODEL || process.env.GEMINI_REVISE_MODEL || "gemini-2.5-flash";
    return process.env.GEMINI_GENERATE_MODEL || "gemini-2.5-flash";
  }

  if (provider === "groq") {
    if (task === "chat") return process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile";
    if (task === "extract") return process.env.GROQ_EXTRACT_MODEL || process.env.GROQ_GENERATE_MODEL || "llama-3.3-70b-versatile";
    if (task === "revise_section") return process.env.GROQ_REVISE_SECTION_MODEL || process.env.GROQ_REVISE_MODEL || "llama-3.3-70b-versatile";
    if (task === "revise_document") return process.env.GROQ_REVISE_DOCUMENT_MODEL || process.env.GROQ_REVISE_MODEL || "llama-3.3-70b-versatile";
    return process.env.GROQ_GENERATE_MODEL || "llama-3.3-70b-versatile";
  }

  if (task === "chat") {
    return (
      process.env.NINE_ROUTER_CHAT_MODEL ||
      process.env["9ROUTER_CHAT_MODEL"] ||
      "auto"
    );
  }

  if (task === "extract") {
    return (
      process.env.NINE_ROUTER_EXTRACT_MODEL ||
      process.env.NINE_ROUTER_GENERATE_MODEL ||
      process.env.NINE_ROUTER_CHAT_MODEL ||
      process.env["9ROUTER_EXTRACT_MODEL"] ||
      process.env["9ROUTER_GENERATE_MODEL"] ||
      process.env["9ROUTER_CHAT_MODEL"] ||
      "auto"
    );
  }

  if (task === "revise_section") {
    return (
      process.env.NINE_ROUTER_REVISE_SECTION_MODEL ||
      process.env.NINE_ROUTER_REVISE_MODEL ||
      process.env.NINE_ROUTER_CHAT_MODEL ||
      process.env["9ROUTER_REVISE_SECTION_MODEL"] ||
      process.env["9ROUTER_REVISE_MODEL"] ||
      process.env["9ROUTER_CHAT_MODEL"] ||
      "auto"
    );
  }

  if (task === "revise_document") {
    return (
      process.env.NINE_ROUTER_REVISE_DOCUMENT_MODEL ||
      process.env.NINE_ROUTER_REVISE_MODEL ||
      process.env.NINE_ROUTER_GENERATE_MODEL ||
      process.env["9ROUTER_REVISE_DOCUMENT_MODEL"] ||
      process.env["9ROUTER_REVISE_MODEL"] ||
      process.env["9ROUTER_GENERATE_MODEL"] ||
      "kr/claude-sonnet-4.5"
    );
  }

  return (
    process.env.NINE_ROUTER_GENERATE_MODEL ||
    process.env.NINE_ROUTER_CHAT_MODEL ||
    process.env["9ROUTER_GENERATE_MODEL"] ||
    process.env["9ROUTER_CHAT_MODEL"] ||
    "kr/claude-sonnet-4.5"
  );
}

export function getAiMaxTokens(task: AiTaskType, fallback: number) {
  const prefix = getTaskEnvPrefix(task);
  return readIntEnv(`AI_${prefix}_MAX_TOKENS`, fallback);
}

export function isProviderQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /(429|quota|rate limit|too many|insufficient|billing|exceeded|limit reached|resource exhausted)/i.test(
    message
  );
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function hashAiRequest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function getDailyLimit(task: AiTaskType) {
  if (task === "chat") return readIntEnv("AI_DAILY_CHAT_LIMIT", 60);
  if (task === "revise_section") return readIntEnv("AI_DAILY_REVISE_SECTION_LIMIT", 20);
  if (task === "revise_document") return readIntEnv("AI_DAILY_REVISE_DOCUMENT_LIMIT", 3);
  return 0;
}

function getDailyCounterField(task: AiTaskType) {
  if (task === "chat") return "chat_daily_count";
  if (task === "revise_section") return "revise_section_daily_count";
  if (task === "revise_document") return "revise_document_daily_count";
  return `${task}_daily_count`;
}

export async function assertAndConsumeDailyQuota(user: AuthenticatedUser, task: AiTaskType) {
  const limit = getDailyLimit(task);

  if (limit <= 0) {
    return;
  }

  const date = todayKey();
  const counterRef = adminDb.collection("ai_usage_counters").doc(`${user.uid}_${task}_${date}`);
  const userRef = adminDb.collection("users").doc(user.uid);
  const counterField = getDailyCounterField(task);

  await adminDb.runTransaction(async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const userSnap = await transaction.get(userRef);
    const currentCount = counterSnap.exists
      ? Number(counterSnap.data()?.count || 0)
      : 0;

    if (currentCount >= limit) {
      throw new AiQuotaError(
        task === "chat"
          ? "Kuota AI harian habis. Coba lagi besok atau lanjutkan dari dokumen yang sudah ada."
          : "Kuota revisi AI harian habis. Coba lagi besok atau gunakan edit manual."
      );
    }

    const userData = userSnap.data() || {};
    const usage = typeof userData.usage === "object" && userData.usage ? userData.usage as Record<string, unknown> : {};
    const usageDate = typeof usage.date === "string" ? usage.date : "";
    const shouldResetDaily = usageDate !== date;
    const nextDailyCount = shouldResetDaily ? 1 : Number(usage[counterField] || 0) + 1;

    transaction.set(
      counterRef,
      {
        count: admin.firestore.FieldValue.increment(1),
        date,
        task_type: task,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        user_id: user.uid,
      },
      { merge: true }
    );

    transaction.set(
      userRef,
      {
        usage: {
          ...(shouldResetDaily
            ? {
                chat_daily_count: 0,
                revise_document_daily_count: 0,
                revise_section_daily_count: 0,
              }
            : {}),
          [counterField]: nextDailyCount,
          date,
          last_used_at: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  });
}

export async function getExistingGeneratedOutputId(user: AuthenticatedUser) {
  const snap = await adminDb
    .collection("outputs")
    .where("user_id", "==", user.uid)
    .limit(1)
    .get();

  if (snap.empty) {
    return null;
  }

  return snap.docs[0].id;
}

function isFreshTimestamp(value: unknown, ttlMs: number) {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return Date.now() - value.toDate().getTime() < ttlMs;
  }

  return false;
}

export async function startAiDedupe(hash: string, metadata: Record<string, unknown>): Promise<DedupeState> {
  const ttlMs = readIntEnv("AI_DEDUPE_TTL_MS", 10 * 60 * 1000);
  const ref = adminDb.collection("ai_request_locks").doc(hash);

  return adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data() || {};
    const status = typeof data.status === "string" ? data.status : "";

    if (snap.exists && isFreshTimestamp(data.updated_at || data.created_at, ttlMs)) {
      if (status === "completed" && data.response && typeof data.response === "object") {
        return { status: "completed", response: data.response as Record<string, unknown> };
      }

      if (status === "processing") {
        return { status: "processing" };
      }
    }

    transaction.set(
      ref,
      {
        ...metadata,
        hash,
        status: "processing",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { status: "started" };
  });
}

export async function completeAiDedupe(hash: string, response: Record<string, unknown>) {
  await adminDb.collection("ai_request_locks").doc(hash).set(
    {
      response,
      status: "completed",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function failAiDedupe(hash: string, error: unknown) {
  await adminDb.collection("ai_request_locks").doc(hash).set(
    {
      error_message: error instanceof Error ? error.message : String(error),
      status: "failed",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function recordAiUsage({
  endpoint,
  inputText,
  model,
  outputText = "",
  provider,
  status,
  task,
  user,
}: {
  endpoint: string;
  inputText: string;
  model?: string;
  outputText?: string;
  provider?: AiProvider | string;
  status: "success" | "failed" | "cached" | "blocked";
  task: AiTaskType;
  user: AuthenticatedUser;
}) {
  const estimatedInputTokens = estimateTokens(inputText);
  const estimatedOutputTokens = outputText ? estimateTokens(outputText) : 0;
  await Promise.all([
    adminDb.collection("ai_usage").add({
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      endpoint,
      estimated_input_tokens: estimatedInputTokens,
      estimated_output_tokens: estimatedOutputTokens,
      estimated_total_tokens: estimatedInputTokens + estimatedOutputTokens,
      model: model || null,
      provider: provider || null,
      status,
      task_type: task,
      user_email: user.email,
      user_id: user.uid,
    }),
    adminDb.collection("users").doc(user.uid).set(
      {
        usage: {
          [`${task}_total_count`]: admin.firestore.FieldValue.increment(1),
          last_task_type: task,
          last_used_at: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    ),
  ]);
}

export async function recordAiError({
  endpoint,
  error,
  model,
  provider,
  task,
  user,
}: {
  endpoint: string;
  error: unknown;
  model?: string;
  provider?: AiProvider | string;
  task: AiTaskType;
  user: AuthenticatedUser;
}) {
  await adminDb.collection("ai_errors").add({
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    endpoint,
    error_code: error instanceof AiQuotaError ? "quota_exceeded" : "ai_request_failed",
    error_message: error instanceof Error ? error.message : String(error),
    model: model || null,
    provider: provider || null,
    task_type: task,
    user_email: user.email,
    user_id: user.uid,
  });
}
