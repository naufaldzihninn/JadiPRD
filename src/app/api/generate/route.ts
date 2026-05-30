import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { adminDb, admin } from "@/lib/firebase/admin";
import {
  getAuthenticatedUser,
  isUnauthenticatedError,
  touchUserProfile,
} from "@/lib/firebase/auth-admin";
import { ensureMarkdownContent } from "@/lib/markdown/normalize";
import { createOpenAICompatibleCompletion } from "@/lib/ai/openai-compatible";
import {
  completeAiDedupe,
  failAiDedupe,
  getAiMaxTokens,
  getAiModel,
  getAiProviderOrder,
  getExistingGeneratedOutputId,
  hashAiRequest,
  recordAiError,
  recordAiUsage,
  startAiDedupe,
  type AiProvider,
} from "@/lib/ai/governance";

type LocalRole = "user" | "ai";
type Provider = "gemini" | "groq" | "9router";

interface ChatMessage {
  role: LocalRole;
  content: string;
}

interface GenerateRequestBody {
  messages: unknown;
  session_id?: string;
}

interface FeatureBrief {
  name: string;
  description: string;
  priority: "must" | "should" | "could";
}

interface DataEntityBrief {
  name: string;
  description: string;
  fields: string[];
}

interface ScreenBrief {
  name: string;
  purpose: string;
  primary_actions: string[];
  states: string[];
}

interface ExtractedBrief {
  product_name: string;
  overview: string;
  problem_statement: string;
  goals: string[];
  target_users: string[];
  core_features: FeatureBrief[];
  platforms: string[];
  timeline_preference: string;
  tech_stack_preference: string[];
  design_preferences: string[];
  business_rules: string[];
  non_goals: string[];
  assumptions: string[];
  open_questions: string[];
  data_entities: DataEntityBrief[];
  screens: ScreenBrief[];
  success_metrics: string[];
  risks: string[];
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
const targetPrdCharacters = "4.000-6.000";
const targetUiPromptCharacters = "3.500-5.500";
const jsonMaxTokens = getAiMaxTokens("extract", Number(process.env.GENERATE_JSON_MAX_TOKENS || 8192));
const textMaxTokens = getAiMaxTokens("generate", Number(process.env.GENERATE_TEXT_MAX_TOKENS || 20000));

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

function extractCleanJson(rawResponse: string): string {
  const clean = rawResponse.trim();

  if (clean.startsWith("```json")) {
    return clean.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  }

  if (clean.startsWith("```")) {
    return clean.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  return clean;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTokenSizeError(error: unknown) {
  return /(413|request too large|tokens per minute|\btpm\b|reduce your message size|context length|too many tokens|max(?:imum)? tokens|input tokens)/i.test(
    getErrorMessage(error)
  );
}

function truncateForPrompt(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 80)).trim()}\n...[dipersingkat agar tidak melewati limit token]`;
}

function buildCompactConversation(messages: ChatMessage[]) {
  const meaningful = messages.filter((message) => message.content.trim());
  const selected =
    meaningful.length > 16 ? [...meaningful.slice(0, 2), ...meaningful.slice(-14)] : meaningful;

  return truncateForPrompt(
    selected
      .map((message) => {
        const content = truncateForPrompt(message.content.replace(/\s+/g, " ").trim(), 700);
        return `${message.role.toUpperCase()}: ${content}`;
      })
      .join("\n"),
    9000
  );
}

async function runJsonPrompt(prompt: string): Promise<{ model: string; text: string; provider: Provider }> {
  let lastError: unknown = null;

  for (const provider of getAiProviderOrder("extract") as Provider[]) {
    try {
      let rawResponse = "";
      const modelName = getAiModel("extract", provider);

      if (provider === "gemini") {
        if (!genAI) {
          throw new Error("GEMINI_API_KEY belum diatur.");
        }

        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: jsonMaxTokens,
            responseMimeType: "application/json",
          },
        });
        const result = await model.generateContent(prompt);
        rawResponse = result.response.text();
      }

      if (provider === "groq") {
        if (!groq) {
          throw new Error("GROQ_API_KEY belum diatur.");
        }

        const completion = await groq.chat.completions.create({
          model: modelName,
          temperature: 0.2,
          max_tokens: jsonMaxTokens,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        });

        rawResponse = completion.choices[0]?.message?.content || "";
      }

      if (provider === "9router") {
        rawResponse = await createOpenAICompatibleCompletion({
          apiKey: nineRouterApiKey,
          baseUrl: nineRouterBaseUrl,
          maxTokens: jsonMaxTokens,
          messages: [{ role: "user", content: prompt }],
          model: modelName,
          responseFormat: { type: "json_object" },
          temperature: 0.2,
        });
      }

      if (!rawResponse) {
        throw new Error("Respons AI kosong.");
      }

      return { model: modelName, text: extractCleanJson(rawResponse), provider };
    } catch (error: unknown) {
      lastError = error;
      if (isTokenSizeError(error)) {
        console.warn(`Provider JSON ${provider} gagal karena payload terlalu besar; fallback dihentikan.`, error);
        break;
      }
      console.warn(`Provider JSON ${provider} gagal, mencoba fallback...`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Semua provider JSON gagal.");
}

async function runTextPrompt(
  prompt: string,
  options: { maxTokens?: number; task?: "generate" } = {}
): Promise<{ model: string; text: string; provider: Provider }> {
  let lastError: unknown = null;
  const maxTokens = options.maxTokens || textMaxTokens;

  for (const provider of getAiProviderOrder(options.task || "generate") as Provider[]) {
    try {
      let rawResponse = "";
      const modelName = getAiModel(options.task || "generate", provider);

      if (provider === "gemini") {
        if (!genAI) {
          throw new Error("GEMINI_API_KEY belum diatur.");
        }

        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { maxOutputTokens: maxTokens },
        });
        const result = await model.generateContent(prompt);
        rawResponse = result.response.text();
      }

      if (provider === "groq") {
        if (!groq) {
          throw new Error("GROQ_API_KEY belum diatur.");
        }

        const completion = await groq.chat.completions.create({
          model: modelName,
          temperature: 0.25,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        });

        rawResponse = completion.choices[0]?.message?.content || "";
      }

      if (provider === "9router") {
        rawResponse = await createOpenAICompatibleCompletion({
          apiKey: nineRouterApiKey,
          baseUrl: nineRouterBaseUrl,
          maxTokens,
          messages: [{ role: "user", content: prompt }],
          model: modelName,
          temperature: 0.25,
        });
      }

      if (!rawResponse.trim()) {
        throw new Error("Respons AI kosong.");
      }

      return { model: modelName, text: rawResponse.trim(), provider };
    } catch (error: unknown) {
      lastError = error;
      if (isTokenSizeError(error)) {
        console.warn(`Provider text ${provider} gagal karena payload terlalu besar; fallback dihentikan.`, error);
        break;
      }
      console.warn(`Provider text ${provider} gagal, mencoba fallback...`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Semua provider text gagal.");
}

function hasUnclosedCodeFence(markdown: string) {
  const fenceCount = markdown.match(/```/g)?.length || 0;
  return fenceCount % 2 !== 0;
}

function hasLikelyCutEnding(markdown: string) {
  const trimmed = markdown.trim();

  if (!trimmed) {
    return true;
  }

  if (hasUnclosedCodeFence(trimmed)) {
    return true;
  }

  const lastLine = trimmed.split("\n").at(-1)?.trim() || "";
  const endsCleanly = /[.!?)]$/.test(lastLine) || lastLine.startsWith("|") || lastLine === "```";
  const endsWithBrokenWord = /\b\w{1,4}$/.test(lastLine) && !/[.!?:;)]$/.test(lastLine);

  return !endsCleanly || endsWithBrokenWord;
}

async function completeIfCut({
  basePrompt,
  content,
  documentName,
}: {
  basePrompt: string;
  content: string;
  documentName: string;
}) {
  if (!hasLikelyCutEnding(content)) {
    return content;
  }

  const continuation = await runTextPrompt(
    `
Dokumen ${documentName} berikut terpotong di bagian akhir. Lanjutkan persis dari titik terakhir tanpa mengulang bagian yang sudah ada.

Aturan:
1. Kembalikan HANYA lanjutan markdown.
2. Jangan mulai ulang dari judul.
3. Jangan mengubah isi sebelumnya.
4. Jika code fence belum ditutup, lanjutkan sampai fence tertutup.
5. Akhiri dokumen dengan kalimat utuh.

Prompt awal:
${basePrompt}

Dokumen yang sudah ada:
${content}
`,
    { maxTokens: Math.floor(textMaxTokens / 2) }
  );

  return `${content.trim()}\n${continuation.text.trim()}`;
}

function buildExtractionPrompt(messages: ChatMessage[]): string {
  const conversation = buildCompactConversation(messages);

  return `
Kamu adalah senior product manager yang sedang menyiapkan bahan PRD final untuk tim engineering.
Ekstrak requirement produk dari percakapan berikut TANPA berhalusinasi, tapi lakukan inferensi produk yang wajar jika konteksnya kuat.
Jika data tidak ada atau terlalu spekulatif, isi ke assumptions atau open_questions, jangan dikarang sebagai fakta.
Jangan mengubah preferensi user menjadi fakta teknis jika user belum menyebutkannya. Bedakan fakta, asumsi, dan pertanyaan terbuka dengan ketat.
Jika user menyerahkan pilihan teknis ke AI, contoh "AI pilih", "ikut saranmu", atau "pakai rekomendasi terbaik", simpan keputusan teknis sebagai rekomendasi berbasis konteks di tech_stack_preference dan tambahkan alasan ringkas di assumptions. Jangan menuliskannya seolah user sendiri memilih stack tersebut.
Jika user menyebut warna, nuansa visual, referensi UI, atau menyerahkan pilihan desain ke AI, simpan di design_preferences. Jika user menyerahkan ke AI, tulis rekomendasi desain berbasis konteks: jenis produk, target user, platform, perangkat, frekuensi pemakaian, aksesibilitas, dan tingkat formalitas. Jangan mengarang brand identity resmi.
Jangan menambahkan angka metrik, integrasi, role, harga, SLA, atau target bisnis yang tidak muncul di percakapan. Jika dibutuhkan untuk kualitas PRD, masukkan sebagai [PERLU_KONFIRMASI] di open_questions.
Gunakan istilah umum produk/SaaS yang natural jika lebih jelas daripada terjemahan kaku, seperti dashboard, workspace, database, role, route, state, dan UI Prompt.

Riwayat percakapan:
${conversation}

Kembalikan HANYA JSON murni dengan struktur persis:
{
  "product_name": "",
  "overview": "",
  "problem_statement": "",
  "goals": [""],
  "target_users": [""],
  "core_features": [
    {
      "name": "",
      "description": "",
      "priority": "must"
    }
  ],
  "platforms": ["web", "mobile"],
  "timeline_preference": "",
  "tech_stack_preference": [""],
  "design_preferences": [""],
  "business_rules": [""],
  "non_goals": [""],
  "assumptions": [""],
  "open_questions": [""],
  "data_entities": [
    {
      "name": "",
      "description": "",
      "fields": [""]
    }
  ],
  "screens": [
    {
      "name": "",
      "purpose": "",
      "primary_actions": [""],
      "states": ["default", "loading", "empty", "error"]
    }
  ],
  "success_metrics": [""],
  "risks": [""]
}
`;
}

function buildPrdMarkdownPrompt(brief: ExtractedBrief, existingPrd?: string): string {
  return `
Kamu adalah principal product manager. Tulis PRD final dalam markdown murni, bukan JSON.

Ringkasan proyek:
${JSON.stringify(brief, null, 2)}

${existingPrd ? `PRD saat ini yang perlu diperbaiki dan diperdalam:\n${existingPrd}\n` : ""}

Aturan wajib:
1. Tulis hanya markdown PRD, tanpa pembuka, tanpa penjelasan di luar dokumen.
2. Bahasa Indonesia profesional, jelas, dan siap dipakai tim engineering.
3. Target panjang ${targetPrdCharacters} karakter. Padat seperti contoh: jangan melebar jadi dokumen panjang.
4. Jangan membuat fitur yang tidak didukung ringkasan. Jika perlu asumsi, tandai [ASUMSI].
5. Jika data belum pasti, tulis ringkas di Design & Technical Constraints dengan prefix [PERLU_KONFIRMASI].
6. Wajib ada diagram mermaid sequenceDiagram dan erDiagram, tapi buat diagram sederhana dan relevan.
   Untuk erDiagram, gunakan syntax Mermaid valid:
   - entity tanpa spasi, tanpa tanda hubung, tanpa kurung. Contoh: USER, ORDER_ITEM.
   - field format: "string name", "int quantity", "datetime created_at", bukan SQL seperti UUID id PK atau VARCHAR.
   - relasi format: USER ||--o{ ORDER : creates.
   - maksimal 6 entity dan 8 relasi.
   - jangan gunakan enum inline, tanda kutip di field, FK/PK suffix bebas SQL, atau tipe SQL seperti VARCHAR/DECIMAL/BOOLEAN.
7. Jangan gunakan "dll", "dan sebagainya", atau placeholder ambigu.
8. Jangan menulis kalimat generik seperti "modern dan mudah digunakan" tanpa keputusan konkret.
9. Requirements cukup berupa bullet tingkat tinggi. Core Features cukup 4-6 fitur MVP utama, masing-masing 2-4 sub-bullet.
10. Jangan membuat acceptance criteria panjang per fitur. Jika perlu, masukkan kriteria uji singkat di sub-bullet fitur.
11. Bagian Design & Technical Constraints wajib memisahkan fakta dari rekomendasi. Jika stack belum dipilih user, tulis sebagai [ASUMSI].
    Jika user menyerahkan pilihan stack ke AI, tulis sebagai "Rekomendasi stack [ASUMSI]" beserta alasan dan trade-off.
12. Jika arah visual belum dipilih user, tulis ringkas sebagai "Rekomendasi desain [ASUMSI]" dengan dasar keputusan, bukan klaim brand. Jika user sudah memilih warna/nuansa, sebutkan sebagai preferensi user.
13. Jangan membuat metrik palsu, persona palsu, role tambahan, integrasi eksternal, metode pembayaran, notifikasi, atau laporan jika tidak ada dasar dari ringkasan. Jika masuk akal tapi belum dikonfirmasi, masukkan ke [ASUMSI] atau [PERLU_KONFIRMASI].
14. Hindari kata "cepat", "mudah", "optimal", "intuitif", atau "real-time" kecuali ada definisi operasionalnya.
15. Gunakan istilah produk/SaaS yang natural jika lebih presisi daripada terjemahan kaku: dashboard, workspace, role, route, state, database, API, UI Prompt.
16. Sebelum selesai, audit sendiri: hapus repetisi, klaim kosong, fitur karangan, dan instruksi yang tidak bisa dieksekusi.

Struktur wajib:
# PRD — Project Requirements Document
## 1. Overview
## 2. Requirements
## 3. Core Features
## 4. User Flow
## 5. Architecture
## 6. Database Schema
## 7. Design & Technical Constraints
`;
}

function buildUiPromptMarkdownPrompt(
  brief: ExtractedBrief,
  prdContent: string,
  existingUiPrompt?: string
): string {
  return `
Kamu adalah staff UX architect. Tulis UI Prompt final dalam markdown murni, bukan JSON.

Ringkasan proyek:
${JSON.stringify(brief, null, 2)}

PRD acuan:
${prdContent}

${existingUiPrompt ? `UI Prompt saat ini yang perlu diperbaiki dan diperdalam:\n${existingUiPrompt}\n` : ""}

Aturan wajib:
1. Tulis hanya markdown UI Prompt, tanpa pembuka, tanpa penjelasan di luar dokumen.
2. Bahasa Indonesia profesional, instruksional, dan siap ditempel ke Stitch/Lovable.
3. Target panjang ${targetUiPromptCharacters} karakter. Padat, tidak mengulang PRD, dan tidak membuat daftar terlalu panjang.
4. Prompt harus anti-halu: sebutkan halaman, komponen, data, aksi, validasi, state loading/empty/error/success, dan hal yang tidak boleh dikarang.
5. Gunakan istilah "UI Prompt", bukan "Prompt UI".
6. Jangan gunakan "dll", "dan sebagainya", atau placeholder ambigu.
7. Jangan memakai frasa generik seperti "buat UI modern", "tampilan menarik", atau "sesuaikan kebutuhan" tanpa token dan keputusan spesifik.
8. Untuk setiap layar, tulis satu paragraf/bullet padat: tujuan, komponen utama, data, aksi, validasi, state, dan responsivitas.
9. Komponen & State cukup berisi komponen lintas layar yang benar-benar penting. Jangan tulis props panjang kecuali krusial.
10. Design System wajib konkret: warna, font, radius, spacing, density, gaya tabel/form/modal/toast, dan aturan ikon.
11. Guardrails wajib melarang data palsu, halaman tambahan yang tidak disebut, integrasi yang belum disetujui, dan dekorasi visual tanpa fungsi.
12. Builder Prompt wajib berupa instruksi langsung untuk AI builder, 10-16 bullet yang padat, dan tidak boleh merujuk "lihat dokumen di atas".
13. Jangan membuat halaman, menu, role, data dummy, chart, integrasi, notifikasi, atau empty illustration yang tidak didukung PRD. Jika perlu placeholder, tulis "gunakan state kosong berbasis data real", bukan data palsu.
14. UI harus cocok untuk aplikasi kerja/SaaS: padat tapi mudah dipindai, navigasi jelas, tabel/form efisien, tidak terasa seperti landing page marketing.
15. Jangan memakai hero besar, decorative orb/blob, kartu bersarang, atau visual yang tidak membantu workflow produk.
16. Jika PRD belum menentukan brand visual, berikan token desain netral dan jelaskan sebagai [ASUMSI_DESAIN], bukan fakta brand.
17. Design System harus memakai design_preferences jika tersedia. Jika user memilih "AI pilih arah visual terbaik", pilih satu arah visual final dengan alasan berbasis konteks produk, target user, platform, frekuensi penggunaan, dan aksesibilitas. Tulis sebagai [ASUMSI_DESAIN], bukan pilihan user.
18. Hindari ciri UI yang terlihat seperti hasil generate AI:
   - semua section berbentuk card besar dengan radius sama
   - grid kartu 3 kolom untuk semua hal
   - ikon di setiap card tanpa fungsi
   - gradient mencolok, glow, glassmorphism, bokeh, orb, dan shadow dramatis
   - heading terlalu besar di area kerja
   - copy marketing seperti "powerful", "seamless", "beautiful", "next-gen"
   - layout terlalu simetris tanpa prioritas tugas
19. Buat arahan desain terasa seperti produk SaaS sungguhan:
   - gunakan sidebar/topbar seperlunya, bukan dekorasi
   - prioritaskan tabel, list, filter, search, form, drawer, modal, toast, dan empty state yang realistis
   - pakai density compact/comfortable yang konsisten
   - bedakan primary action, secondary action, dan destructive action
   - gunakan warna aksen hemat untuk status, selection, focus ring, dan CTA utama
   - gunakan spacing 4/8/12/16/24/32 dan radius 6-8px
   - batasi shadow, gunakan border dan background subtle untuk hierarchy
20. Untuk tiap layar, jelaskan hierarchy informasi secara singkat: prioritas pertama, secondary panel, dan drawer/modal bila ada.
21. Sebelum selesai, audit sendiri: buang AI slop, klaim visual generik, komponen tanpa data, state yang hilang, dan fitur yang tidak ada di PRD.

Struktur wajib:
# UI Prompt — Builder Brief
## 1. Product Context
## 2. App Structure
## 3. Screens
## 4. Components & States
## 5. Design System
## 6. Interaction Rules
## 7. Guardrails
## 8. Builder Prompt
`;
}

function hasAllRequiredSections(markdown: string, sections: string[]): boolean {
  const lower = markdown.toLowerCase();
  return sections.every((section) => lower.includes(section.toLowerCase()));
}

function needsExpansion(prd: string, uiPrompt: string): boolean {
  const prdSections = [
    "## 1. Overview",
    "## 2. Requirements",
    "## 3. Core Features",
    "## 4. User Flow",
    "## 5. Architecture",
    "## 6. Database Schema",
    "## 7. Design & Technical Constraints",
  ];

  const uiSections = [
    "## 1. Product Context",
    "## 2. App Structure",
    "## 3. Screens",
    "## 4. Components & States",
    "## 5. Design System",
    "## 6. Interaction Rules",
    "## 7. Guardrails",
    "## 8. Builder Prompt",
  ];

  return (
    prd.length < 2500 ||
    uiPrompt.length < 2500 ||
    !hasAllRequiredSections(prd, prdSections) ||
    !hasAllRequiredSections(uiPrompt, uiSections) ||
    !prd.includes("```mermaid") ||
    !uiPrompt.toLowerCase().includes("loading") ||
    !uiPrompt.toLowerCase().includes("empty") ||
    !uiPrompt.toLowerCase().includes("error")
  );
}

function normalizeBrief(data: Partial<ExtractedBrief>): ExtractedBrief {
  const featureList = Array.isArray(data.core_features)
    ? data.core_features
        .map((feature) => {
          const priority = feature?.priority;
          const safePriority: "must" | "should" | "could" =
            priority === "must" || priority === "should" || priority === "could"
              ? priority
              : "must";

          return {
            name: typeof feature?.name === "string" ? feature.name : "",
            description:
              typeof feature?.description === "string" ? feature.description : "",
            priority: safePriority,
          };
        })
        .filter((feature) => feature.name || feature.description)
    : [];

  return {
    product_name: typeof data.product_name === "string" ? data.product_name : "",
    overview: typeof data.overview === "string" ? data.overview : "",
    problem_statement:
      typeof data.problem_statement === "string" ? data.problem_statement : "",
    goals: Array.isArray(data.goals)
      ? data.goals.filter((goal): goal is string => typeof goal === "string")
      : [],
    target_users: Array.isArray(data.target_users)
      ? data.target_users.filter((user): user is string => typeof user === "string")
      : [],
    core_features: featureList,
    platforms: Array.isArray(data.platforms)
      ? data.platforms.filter((platform): platform is string => typeof platform === "string")
      : [],
    timeline_preference:
      typeof data.timeline_preference === "string" ? data.timeline_preference : "",
    tech_stack_preference: Array.isArray(data.tech_stack_preference)
      ? data.tech_stack_preference.filter(
          (stack): stack is string => typeof stack === "string"
        )
      : [],
    design_preferences: Array.isArray(data.design_preferences)
      ? data.design_preferences.filter(
          (preference): preference is string => typeof preference === "string"
        )
      : [],
    business_rules: Array.isArray(data.business_rules)
      ? data.business_rules.filter((rule): rule is string => typeof rule === "string")
      : [],
    non_goals: Array.isArray(data.non_goals)
      ? data.non_goals.filter((goal): goal is string => typeof goal === "string")
      : [],
    assumptions: Array.isArray(data.assumptions)
      ? data.assumptions.filter((item): item is string => typeof item === "string")
      : [],
    open_questions: Array.isArray(data.open_questions)
      ? data.open_questions.filter((item): item is string => typeof item === "string")
      : [],
    data_entities: Array.isArray(data.data_entities)
      ? data.data_entities
          .map((entity) => ({
            name: typeof entity?.name === "string" ? entity.name : "",
            description:
              typeof entity?.description === "string" ? entity.description : "",
            fields: Array.isArray(entity?.fields)
              ? entity.fields.filter((field): field is string => typeof field === "string")
              : [],
          }))
          .filter((entity) => entity.name || entity.description)
      : [],
    screens: Array.isArray(data.screens)
      ? data.screens
          .map((screen) => ({
            name: typeof screen?.name === "string" ? screen.name : "",
            purpose: typeof screen?.purpose === "string" ? screen.purpose : "",
            primary_actions: Array.isArray(screen?.primary_actions)
              ? screen.primary_actions.filter(
                  (action): action is string => typeof action === "string"
                )
              : [],
            states: Array.isArray(screen?.states)
              ? screen.states.filter((state): state is string => typeof state === "string")
              : [],
          }))
          .filter((screen) => screen.name || screen.purpose)
      : [],
    success_metrics: Array.isArray(data.success_metrics)
      ? data.success_metrics.filter((metric): metric is string => typeof metric === "string")
      : [],
    risks: Array.isArray(data.risks)
      ? data.risks.filter((risk): risk is string => typeof risk === "string")
      : [],
  };
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function getProjectTitle(brief: ExtractedBrief) {
  const candidate =
    brief.product_name ||
    brief.overview.match(/(?:aplikasi|sistem|platform)\s+([^.,\n]+)/i)?.[0] ||
    "";
  const cleanTitle = candidate
    .replace(/[*_`#]/g, "")
    .replace(/^nama produk\s*:\s*/i, "")
    .trim();

  if (
    cleanTitle &&
    !/^(prd|product requirements document|project requirements document|dokumen prd)$/i.test(
      cleanTitle
    )
  ) {
    return cleanTitle.slice(0, 90);
  }

  return `Proyek ${new Date().toLocaleDateString("id-ID")}`;
}

export async function POST(req: NextRequest) {
  let dedupeHash = "";
  let userForError: Awaited<ReturnType<typeof getAuthenticatedUser>> | null = null;

  try {
    const user = await getAuthenticatedUser(req);
    userForError = user;
    const body = (await req.json()) as GenerateRequestBody;

    if (!Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "Invalid messages format" },
        { status: 400 }
      );
    }

    const messages = body.messages.filter(isChatMessage);

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada pesan valid yang dikirim." },
        { status: 400 }
      );
    }

    const existingOutputId = await getExistingGeneratedOutputId(user);

    if (existingOutputId) {
      const response = {
        success: true,
        existing: true,
        message: "Akun ini sudah punya PRD. Kamu diarahkan ke dokumen yang sudah ada.",
        output_id: existingOutputId,
      };

      await recordAiUsage({
        endpoint: "/api/generate",
        inputText: messages.map((message) => message.content).join("\n"),
        outputText: "",
        status: "cached",
        task: "generate",
        user,
      });

      return NextResponse.json(response);
    }

    dedupeHash = hashAiRequest({
      endpoint: "/api/generate",
      messages: messages.map((message) => ({
        content: message.content,
        role: message.role,
      })),
      session_id: typeof body.session_id === "string" ? body.session_id : null,
      user_id: user.uid,
    });
    const dedupeState = await startAiDedupe(dedupeHash, {
      endpoint: "/api/generate",
      task_type: "generate",
      user_id: user.uid,
    });

    if (dedupeState.status === "completed") {
      await recordAiUsage({
        endpoint: "/api/generate",
        inputText: messages.map((message) => message.content).join("\n"),
        outputText: "",
        status: "cached",
        task: "generate",
        user,
      });

      return NextResponse.json(dedupeState.response);
    }

    if (dedupeState.status === "processing") {
      return NextResponse.json(
        { error: "Dokumen sedang dibuat. Tunggu sebentar lalu buka dashboard." },
        { status: 409 }
      );
    }

    const extraction = await runJsonPrompt(buildExtractionPrompt(messages));
    const extractedBrief = normalizeBrief(
      parseJson<Partial<ExtractedBrief>>(extraction.text)
    );

    const prdPrompt = buildPrdMarkdownPrompt(extractedBrief);
    const prdDraft = await runTextPrompt(prdPrompt);
    let finalPrd = ensureMarkdownContent(prdDraft.text, {
      fallback: "Data PRD kosong.",
      title: "PRD",
    });
    finalPrd = ensureMarkdownContent(
      await completeIfCut({
        basePrompt: prdPrompt,
        content: finalPrd,
        documentName: "PRD",
      }),
      {
        fallback: finalPrd,
        title: "PRD",
      }
    );

    const uiMarkdownPrompt = buildUiPromptMarkdownPrompt(extractedBrief, finalPrd);
    const uiPromptDraft = await runTextPrompt(uiMarkdownPrompt);
    let finalUiPrompt = ensureMarkdownContent(uiPromptDraft.text, {
      fallback: "Data UI Prompt kosong.",
      title: "UI Prompt",
    });
    finalUiPrompt = ensureMarkdownContent(
      await completeIfCut({
        basePrompt: uiMarkdownPrompt,
        content: finalUiPrompt,
        documentName: "UI Prompt",
      }),
      {
        fallback: finalUiPrompt,
        title: "UI Prompt",
      }
    );

    let finalProvider: Provider =
      prdDraft.provider === uiPromptDraft.provider ? prdDraft.provider : uiPromptDraft.provider;
    let finalModel =
      prdDraft.model === uiPromptDraft.model
        ? prdDraft.model
        : `${prdDraft.model}, ${uiPromptDraft.model}`;
    const finalQaScore: number | null = null;
    let finalIssuesFixed: string[] = [];

    if (needsExpansion(finalPrd, finalUiPrompt)) {
      const expandedPrdPrompt = buildPrdMarkdownPrompt(extractedBrief, finalPrd);
      const expandedPrd = await runTextPrompt(
        expandedPrdPrompt,
        { maxTokens: textMaxTokens }
      );
      finalPrd = ensureMarkdownContent(expandedPrd.text, {
        fallback: finalPrd,
        title: "PRD",
      });
      finalPrd = ensureMarkdownContent(
        await completeIfCut({
          basePrompt: expandedPrdPrompt,
          content: finalPrd,
          documentName: "PRD",
        }),
        {
          fallback: finalPrd,
          title: "PRD",
        }
      );

      const expandedUiPromptText = buildUiPromptMarkdownPrompt(
        extractedBrief,
        finalPrd,
        finalUiPrompt
      );
      const expandedUiPrompt = await runTextPrompt(
        expandedUiPromptText,
        { maxTokens: textMaxTokens }
      );
      finalUiPrompt = ensureMarkdownContent(expandedUiPrompt.text, {
        fallback: finalUiPrompt,
        title: "UI Prompt",
      });
      finalUiPrompt = ensureMarkdownContent(
        await completeIfCut({
          basePrompt: expandedUiPromptText,
          content: finalUiPrompt,
          documentName: "UI Prompt",
        }),
        {
          fallback: finalUiPrompt,
          title: "UI Prompt",
        }
      );
      finalProvider =
        expandedPrd.provider === expandedUiPrompt.provider
          ? expandedPrd.provider
          : expandedUiPrompt.provider;
      finalModel =
        expandedPrd.model === expandedUiPrompt.model
          ? expandedPrd.model
          : `${expandedPrd.model}, ${expandedUiPrompt.model}`;
      finalIssuesFixed = ["Dokumen diperbaiki karena belum memenuhi struktur ringkas wajib."];
    }

    if (!finalPrd || !finalUiPrompt) {
      throw new Error("Dokumen akhir kosong.");
    }

    const projectName = getProjectTitle(extractedBrief);
    await touchUserProfile(user);

    const projectRef = await adminDb.collection("projects").add({
      user_email: user.email,
      user_id: user.uid,
      user_name: user.name,
      user_photo_url: user.picture,
      session_id: typeof body.session_id === "string" ? body.session_id : null,
      name: projectName,
      product_name: projectName,
      status: "generated",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    await adminDb.collection("conversations").doc(projectRef.id).set({
      messages,
      collected_data: extractedBrief,
      user_email: user.email,
      user_id: user.uid,
      user_name: user.name,
      session_id: typeof body.session_id === "string" ? body.session_id : null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const outputRef = await adminDb.collection("outputs").add({
      project_id: projectRef.id,
      title: projectName,
      product_name: projectName,
      prd_content: finalPrd,
      ui_prompt_content: finalUiPrompt,
      user_email: user.email,
      user_id: user.uid,
      user_name: user.name,
      user_photo_url: user.picture,
      session_id: typeof body.session_id === "string" ? body.session_id : null,
      ai_provider: finalProvider,
      ai_model:
        finalModel,
      qa_score: finalQaScore,
      issues_fixed: finalIssuesFixed,
      version: 1,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    await outputRef.collection("versions").doc("v1").set({
      prd_content: finalPrd,
      revision_mode: "generated",
      ui_prompt_content: finalUiPrompt,
      user_id: user.uid,
      version: 1,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (typeof body.session_id === "string" && body.session_id) {
      await adminDb.collection("interview_sessions").doc(body.session_id).set(
        {
          output_id: outputRef.id,
          status: "generated",
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const response = {
      success: true,
      project_id: projectRef.id,
      output_id: outputRef.id,
    };

    await completeAiDedupe(dedupeHash, response);
    await recordAiUsage({
      endpoint: "/api/generate",
      inputText: messages.map((message) => message.content).join("\n"),
      model: finalModel,
      outputText: `${finalPrd}\n\n${finalUiPrompt}`,
      provider: finalProvider as AiProvider,
      status: "success",
      task: "generate",
      user,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("Galat API generate:", error);
    if (dedupeHash) {
      await failAiDedupe(dedupeHash, error);
    }

    if (userForError) {
      await recordAiError({
        endpoint: "/api/generate",
        error,
        task: "generate",
        user: userForError,
      });
    }

    if (isUnauthenticatedError(error)) {
      return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });
    }

    const message =
      error instanceof Error ? error.message : "Gagal membuat dokumen.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
