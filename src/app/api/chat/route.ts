import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import {
  getAuthenticatedUser,
  isUnauthenticatedError,
  touchUserProfile,
} from "@/lib/firebase/auth-admin";
import {
  createOpenAICompatibleCompletion,
  type OpenAICompatibleMessage,
} from "@/lib/ai/openai-compatible";
import {
  assertAndConsumeDailyQuota,
  getAiMaxTokens,
  getAiModel,
  getAiProviderOrder,
  recordAiError,
  recordAiUsage,
  type AiProvider,
} from "@/lib/ai/governance";

type LocalRole = "user" | "ai";

interface ChatMessage {
  role: LocalRole;
  content: string;
}

interface ChatRequestBody {
  messages: unknown;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChatMessage>;
  return (
    (candidate.role === "user" || candidate.role === "ai") &&
    typeof candidate.content === "string" &&
    candidate.content.trim().length > 0
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

const geminiApiKey = process.env.GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;
const nineRouterApiKey =
  process.env.NINE_ROUTER_API_KEY || process.env["9ROUTER_API_KEY"];
const nineRouterBaseUrl =
  process.env.NINE_ROUTER_BASE_URL ||
  process.env["9ROUTER_BASE_URL"] ||
  "http://localhost:20128/v1";
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;
const chatMaxTokens = getAiMaxTokens("chat", Number(process.env.CHAT_MAX_TOKENS || 900));

const systemInstruction = `Kamu adalah manajer produk teknis di JadiPRD. Tugasmu adalah mewawancarai user secara bertahap untuk menggali ide aplikasi mereka yang nantinya akan dijadikan PRD (Dokumen Kebutuhan Produk).
Aturan:
1. Jawab dengan bahasa Indonesia yang santai, asyik, tapi tetap profesional.
2. Tanyakan 1 pertanyaan dalam satu waktu. Jangan menanyakan banyak hal sekaligus.
3. Pertanyaan yang perlu ditanyakan secara bertahap:
   - Apa masalah utama yang ingin diselesaikan?
   - Siapa target penggunanya?
   - Fitur apa yang paling utama?
   - Apakah ada preferensi platform (web / mobile / keduanya)?
   - Berapa estimasi waktu pengerjaan (MVP cepat / jangka panjang)?
   - Ada preferensi teknologi? Jika tidak tahu, berikan rekomendasi teknologi modern.
   - Ada preferensi visual ringan untuk UI? Contoh: warna brand, nuansa produk, atau referensi sederhana. Jika user bingung, tawarkan AI memilih arah visual terbaik.
4. Jika user tidak tahu jawaban teknis atau desain, berikan rekomendasi yang masuk akal dan minta persetujuannya.
5. PENTING: Setiap kali kamu bertanya, WAJIB sertakan 2-4 opsi jawaban cepat di baris paling bawah responsmu. Jangan cetak opsi sebagai bullet biasa. Gunakan format persis seperti ini:
   SUGGESTIONS: [Opsi 1] | [Opsi 2] | [Opsi 3]
   Contoh:
   SUGGESTIONS: [🏃 Hackathon (1-3 hari)] | [📦 MVP (1-2 minggu)] | [🚀 Jangka panjang (1+ bulan)]
6. Jika pertanyaanmu tentang estimasi waktu, platform, target pengguna, fitur utama, teknologi, atau arah visual UI, opsi cepat wajib spesifik untuk pertanyaan itu.
7. Untuk pertanyaan yang mungkin user non-teknis/non-desainer tidak tahu (terutama teknologi, stack, database, arsitektur, platform, prioritas fitur, warna, dan gaya UI), selalu sertakan satu opsi seperti "🤖 AI pilih rekomendasi terbaik", "🤖 AI pilih arah visual terbaik", atau "🤖 AI bantu prioritaskan".
8. Jika user memilih agar AI yang menentukan rekomendasi teknis, jangan asal sebut stack. Pilih berdasarkan konteks yang sudah ada: jenis produk, target user, timeline, platform, fitur utama, kebutuhan data, dan kompleksitas. Jelaskan singkat alasan, trade-off, dan tandai keputusan sebagai rekomendasi/asumsi, bukan fakta final.
9. Jika user memilih agar AI yang menentukan arah visual, jangan asal pilih warna. Pilih berdasarkan jenis produk, target user, konteks pemakaian, perangkat, tingkat formalitas brand, aksesibilitas/kontras, dan kebutuhan kerja berulang. Jelaskan alasan singkat dan tandai sebagai rekomendasi/asumsi desain.
10. Jangan mengarang integrasi, teknologi, role, fitur, brand, warna resmi, logo, atau visual identity yang belum disebut user. Jika perlu asumsi, sebutkan dengan jelas dan minta konfirmasi.
11. Jangan menawarkan opsi "buat PRD", "generate PRD", "lanjut buat PRD", atau sejenisnya sebelum data minimum lengkap.
12. Data minimum sebelum boleh menawarkan buat PRD: masalah, target user, fitur utama, platform, timeline/batas MVP, kriteria sukses, petunjuk data, dan satu sinyal desain: preferensi user atau izin "AI pilih arah visual terbaik".
13. Jika kamu baru memberi rekomendasi fitur/teknologi/platform/desain dan masih menanyakan persetujuan atau detail berikutnya, SUGGESTIONS wajib relevan dengan pertanyaan terakhir. Jangan sertakan opsi buat PRD.
14. Jika kamu sudah menyatakan semua data penting lengkap dan bertanya apakah user siap dibuatkan PRD, SUGGESTIONS wajib persis bertema finalisasi: [✅ Ya, buat PRD sekarang] | [✏️ Revisi ringkasan dulu] | [➕ Tambahkan detail lagi]. Jangan beri opsi teknologi/platform/desain lagi di tahap ini.
15. Setelah semua pertanyaan krusial terjawab (sekitar 6-9 giliran), buat ringkasan singkat dan tanyakan apakah user siap untuk membuat PRD.
16. Responsmu harus singkat, maksimal 2-3 paragraf per balasan (tidak termasuk SUGGESTIONS).`;

function toOpenAIMessages(messages: ChatMessage[]): OpenAICompatibleMessage[] {
  return [
    { role: "system", content: systemInstruction },
    ...messages.map((msg) => ({
      role: msg.role === "ai" ? "assistant" as const : "user" as const,
      content: msg.content,
    })),
  ];
}

async function runGeminiChat(messages: ChatMessage[]) {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY belum diatur.");
  }

  const model = genAI.getGenerativeModel({
    model: getAiModel("chat", "gemini"),
    systemInstruction,
  });

  const history = messages.slice(0, -1).map((msg) => ({
    role: msg.role === "ai" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  if (history.length > 0 && history[0].role === "model") {
    history.unshift({
      role: "user",
      parts: [{ text: "Halo AI, ayo kita mulai buat aplikasinya." }],
    });
  }

  const latestMessage = messages[messages.length - 1].content;
  const chat = model.startChat({ history });
  const result = await chat.sendMessage(latestMessage);

  return result.response.text();
}

async function runGroqChat(messages: ChatMessage[]) {
  if (!groq) {
    throw new Error("GROQ_API_KEY belum diatur.");
  }

  const chatCompletion = await groq.chat.completions.create({
    messages: toOpenAIMessages(messages),
    model: getAiModel("chat", "groq"),
    temperature: 0.7,
    max_tokens: chatMaxTokens,
  });

  return chatCompletion.choices[0]?.message?.content || "";
}

async function runNineRouterChat(messages: ChatMessage[]) {
  return createOpenAICompatibleCompletion({
    apiKey: nineRouterApiKey,
    baseUrl: nineRouterBaseUrl,
    maxTokens: chatMaxTokens,
    messages: toOpenAIMessages(messages),
    model: getAiModel("chat", "9router"),
    temperature: 0.7,
  });
}

async function runChatWithFallback(messages: ChatMessage[]) {
  const providers = getAiProviderOrder("chat");

  let lastError: unknown = null;

  for (const provider of providers) {
    try {
      if (provider === "9router") {
        return { reply: await runNineRouterChat(messages), provider, model: getAiModel("chat", provider) };
      }

      if (provider === "gemini") {
        return { reply: await runGeminiChat(messages), provider, model: getAiModel("chat", provider) };
      }

      if (provider === "groq") {
        return { reply: await runGroqChat(messages), provider, model: getAiModel("chat", provider) };
      }
    } catch (error: unknown) {
      lastError = error;
      console.warn(`Provider chat ${provider} gagal, mencoba fallback...`, getErrorMessage(error));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Semua provider chat gagal.");
}

function getBudgetedMessages(messages: ChatMessage[]) {
  const maxMessages = Number(process.env.AI_CHAT_HISTORY_LIMIT || 12);

  if (messages.length <= maxMessages) {
    return messages;
  }

  const firstUserMessage = messages.find((message) => message.role === "user");
  const tail = messages.slice(-(maxMessages - 1));

  if (!firstUserMessage || tail.includes(firstUserMessage)) {
    return messages.slice(-maxMessages);
  }

  return [firstUserMessage, ...tail];
}

export async function POST(req: NextRequest) {
  let userForError: Awaited<ReturnType<typeof getAuthenticatedUser>> | null = null;

  try {
    const user = await getAuthenticatedUser(req);
    userForError = user;
    await touchUserProfile(user);
    const body = (await req.json()) as ChatRequestBody;

    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: "Invalid messages format" }, { status: 400 });
    }

    const messages = body.messages.filter(isChatMessage);

    if (messages.length === 0) {
      return NextResponse.json({ error: "No valid messages provided" }, { status: 400 });
    }

    await assertAndConsumeDailyQuota(user, "chat");
    const budgetedMessages = getBudgetedMessages(messages);
    const result = await runChatWithFallback(budgetedMessages);
    await recordAiUsage({
      endpoint: "/api/chat",
      inputText: budgetedMessages.map((message) => message.content).join("\n"),
      model: result.model,
      outputText: result.reply,
      provider: result.provider as AiProvider,
      status: "success",
      task: "chat",
      user,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Galat API chat:", error);
    if (userForError) {
      await recordAiError({
        endpoint: "/api/chat",
        error,
        task: "chat",
        user: userForError,
      });
    }
    if (isUnauthenticatedError(error)) {
      return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });
    }
    if (error && typeof error === "object" && "status" in error && error.status === 429) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 429 });
    }
    return NextResponse.json({ error: "Gagal memproses chat." }, { status: 500 });
  }
}
