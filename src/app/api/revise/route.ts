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
  assertAndConsumeDailyQuota,
  completeAiDedupe,
  failAiDedupe,
  getAiMaxTokens,
  getAiModel,
  getAiProviderOrder,
  hashAiRequest,
  recordAiError,
  recordAiUsage,
  startAiDedupe,
  type AiProvider,
  type AiTaskType,
} from "@/lib/ai/governance";

type RevisionTarget = "prd" | "ui" | "both";
type RevisionMode = "document" | "section";
type Provider = "gemini" | "groq" | "9router";

interface RevisePayload {
  id: string;
  target: RevisionTarget;
  instruction: string;
  prdContent: string;
  uiContent: string;
  mode?: RevisionMode;
  sectionOccurrence?: number;
  sectionStartLine?: number;
  sectionTitle?: string;
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
const reviseSectionMaxTokens = getAiMaxTokens("revise_section", Number(process.env.REVISE_SECTION_MAX_TOKENS || 4000));
const reviseDocumentMaxTokens = getAiMaxTokens(
  "revise_document",
  Number(process.env.REVISE_TEXT_MAX_TOKENS || process.env.GENERATE_TEXT_MAX_TOKENS || 20000)
);

const createPrompt = ({ target, instruction, prdContent, uiContent }: RevisePayload) => `
Kamu adalah principal product manager dan staff UX architect yang sedang merevisi dokumen produk final.

Tugas:
1. Revisi konten berdasarkan instruksi user, lalu tingkatkan detailnya agar siap dipakai.
2. Output wajib mengikuti format delimiter yang diminta, bukan JSON.
3. Jika target adalah "prd", ubah PRD menjadi lebih lengkap dan pertahankan UI Prompt kecuali ada ketidakkonsistenan besar.
4. Jika target adalah "ui", ubah UI Prompt menjadi lebih jelas untuk Stitch/Lovable dan pertahankan PRD kecuali perlu sinkronisasi istilah.
5. Jika target adalah "both", perbaiki keduanya agar konsisten.
6. PRD idealnya ${targetPrdCharacters} karakter dan memakai struktur ringkas: Overview, Requirements, Core Features, User Flow, Architecture, Database Schema, Design & Technical Constraints.
7. UI Prompt idealnya ${targetUiPromptCharacters} karakter dan memakai struktur ringkas: Product Context, App Structure, Screens, Components & States, Design System, Interaction Rules, Guardrails, Builder Prompt.
8. UI Prompt harus anti-halu: sebutkan halaman, komponen, data, aksi, validasi, state loading/empty/error/success.
9. Jangan gunakan "dll", "dan sebagainya", atau instruksi ambigu.
10. Jangan menambahkan penjelasan di luar delimiter.
11. Jangan menambahkan fitur, integrasi, role, halaman, atau data yang tidak ada di PRD/user instruction. Jika perlu asumsi, tandai [ASUMSI].
12. PRD wajib mempertahankan kriteria diterima yang terukur. Jika ada fitur tanpa kriteria diterima, tambahkan Given/When/Then atau checklist yang bisa diuji.
13. UI Prompt wajib mempertahankan kontrak layar dan komponen. Untuk tiap layar penting, pastikan ada tujuan, komponen, data, aksi, validasi, state loading/empty/error/success, dan perilaku responsive.
14. Hapus AI slop: kalimat generik, jargon kosong, "modern", "intuitif", "user-friendly", atau "sesuaikan" tanpa keputusan spesifik.
15. Jangan membuat metrik palsu, persona palsu, role tambahan, integrasi eksternal, metode pembayaran, notifikasi, laporan, atau halaman baru jika tidak ada dasar dari PRD/instruksi user.
16. Untuk revisi section tertentu, ubah hanya section yang diminta dan sinkronkan bagian lain hanya jika ada konflik langsung.
17. UI Prompt harus tetap cocok untuk aplikasi kerja/SaaS: navigasi jelas, tabel/form efisien, state lengkap, tanpa gaya landing page marketing.
18. Hindari ciri UI yang terlihat seperti hasil generate AI: card besar berulang, grid 3 kolom di semua section, ikon dekoratif berlebihan, gradient/glow/glassmorphism/orb, shadow dramatis, heading terlalu besar di dashboard, dan copy marketing kosong.
19. Arahkan UI menjadi SaaS yang realistis: hierarchy tugas jelas, tabel/list/filter/search/form sebagai pola utama, drawer/modal/toast seperlunya, warna aksen hemat, radius 6-8px, border subtle, shadow minimal, dan density yang konsisten.
20. Sebelum mengembalikan hasil, audit konsistensi PRD dan UI Prompt: nama fitur, role, data entity, route, dan batasan harus selaras.
21. Jangan memanjangkan dokumen demi terlihat lengkap. Prioritaskan bullet padat, diagram sederhana, dan keputusan yang bisa dieksekusi.

Target revisi: ${target}
Instruksi user:
${instruction}

PRD saat ini:
${prdContent}

UI Prompt saat ini:
${uiContent}

Kembalikan HANYA format berikut:
---PRD---
ISI PRD MARKDOWN LENGKAP
---PROMPT_UI---
ISI PROMPT UI MARKDOWN LENGKAP
`;

const createSectionPrompt = ({
  target,
  instruction,
  sectionTitle,
  sectionContent,
}: {
  target: Exclude<RevisionTarget, "both">;
  instruction: string;
  sectionTitle: string;
  sectionContent: string;
}) => `
Kamu sedang merevisi SATU section ${target === "prd" ? "PRD" : "UI Prompt"}.

Aturan keras:
1. Ubah hanya section yang diberikan.
2. Jangan mengembalikan dokumen penuh.
3. Jangan menambah section baru di luar section ini.
4. Pertahankan heading section yang sama kecuali user secara eksplisit meminta judul diganti.
5. Jangan menambahkan fitur, role, data, integrasi, metrik, atau halaman baru tanpa dasar dari catatan user dan isi section.
6. Jika ada asumsi yang benar-benar diperlukan, tandai dengan [ASUMSI] dan buat tetap minimal.
7. Hapus kalimat generik seperti "modern", "intuitif", "user-friendly", "scalable", atau "mudah digunakan" jika tidak diikuti detail yang bisa dieksekusi.
8. Gunakan bahasa Indonesia yang natural. Istilah umum seperti dashboard, workspace, backend, frontend, API, database, empty state, dan loading state boleh tetap dipakai jika lebih jelas.
9. Jika catatan user tidak cukup untuk mengubah sesuatu, lakukan revisi paling kecil yang masuk akal dan jangan mengarang konteks baru.
10. Kembalikan HANYA markdown section final, dimulai dari heading section ini.

Aturan tambahan untuk PRD:
- Jaga kebutuhan tetap bisa diuji.
- Jika menambah/mengubah acceptance criteria, buat spesifik dan bisa diverifikasi.
- Jangan memperlebar scope MVP kecuali catatan user jelas meminta itu.

Aturan tambahan untuk UI Prompt:
- Buat instruksi UI terasa seperti SaaS sungguhan, bukan template AI: hierarchy tugas jelas, density konsisten, tabel/list/form/filter/search dipakai saat relevan, dekorasi hemat.
- Hindari card besar berulang, gradient/glow/glassmorphism/orb, ikon dekoratif berlebihan, copy marketing kosong, dan layout yang terlalu landing-page.
- Untuk layar/komponen yang disentuh, sebutkan state loading/empty/error/success jika relevan.

Judul section:
${sectionTitle}

Catatan user:
${instruction}

Section saat ini:
${sectionContent}
`;

function stripCodeFence(raw: string) {
  let cleaned = raw.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "");
  }

  return cleaned.trim();
}

function parseDelimitedDocuments(raw: string) {
  const cleaned = stripCodeFence(raw);
  const prdMarker = "---PRD---";
  const uiMarker = "---PROMPT_UI---";
  const prdStart = cleaned.indexOf(prdMarker);
  const uiStart = cleaned.indexOf(uiMarker);

  if (prdStart === -1 || uiStart === -1 || uiStart <= prdStart) {
    throw new Error("Format respons revisi tidak valid.");
  }

  return {
    prd_content: cleaned.slice(prdStart + prdMarker.length, uiStart).trim(),
    ui_prompt_content: cleaned.slice(uiStart + uiMarker.length).trim(),
  };
}

function normalizeHeadingText(text: string) {
  return text
    .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, "$1")
    .replace(/\\/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findMarkdownSection(
  content: string,
  sectionTitle: string,
  sectionOccurrence = 1,
  sectionStartLine?: number
) {
  const normalizedTarget = normalizeHeadingText(sectionTitle);
  const lines = content.split("\n");
  let startLine = -1;
  let headingLevel = 0;
  let matchCount = 0;
  const startLineIndex =
    typeof sectionStartLine === "number" && Number.isFinite(sectionStartLine)
      ? sectionStartLine - 1
      : -1;

  if (startLineIndex >= 0 && startLineIndex < lines.length) {
    const directMatch = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(lines[startLineIndex]);

    if (directMatch) {
      startLine = startLineIndex;
      headingLevel = directMatch[1].length;
    }
  }

  if (startLine === -1) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]);

      if (!match) {
        continue;
      }

      if (normalizeHeadingText(match[2]) === normalizedTarget) {
        matchCount += 1;

        if (matchCount !== sectionOccurrence) {
          continue;
        }

        startLine = index;
        headingLevel = match[1].length;
        break;
      }
    }
  }

  if (startLine === -1) {
    throw new Error(`Section "${sectionTitle}" tidak ditemukan di dokumen.`);
  }

  let endLine = lines.length;

  for (let index = startLine + 1; index < lines.length; index += 1) {
    const match = /^(#{2,6})\s+/.exec(lines[index]);

    if (match && match[1].length <= headingLevel) {
      endLine = index;
      break;
    }
  }

  const before = lines.slice(0, startLine).join("\n");
  const section = lines.slice(startLine, endLine).join("\n").trim();
  const after = lines.slice(endLine).join("\n");

  return {
    after,
    before,
    headingLine: lines[startLine],
    section,
  };
}

function replaceMarkdownSection({
  after,
  before,
  headingLine,
  revisedSection,
}: {
  after: string;
  before: string;
  headingLine: string;
  revisedSection: string;
}) {
  let cleanedSection = stripCodeFence(revisedSection);

  if (!/^#{2,6}\s+/.test(cleanedSection)) {
    cleanedSection = `${headingLine}\n\n${cleanedSection}`;
  }

  return [before.trimEnd(), cleanedSection.trim(), after.trimStart()]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function reviseSingleSection(payload: RevisePayload) {
  if (payload.target === "both") {
    throw new Error("Revisi per section hanya bisa untuk PRD atau UI Prompt.");
  }

  if (!payload.sectionTitle?.trim()) {
    throw new Error("Judul section wajib dikirim untuk revisi per section.");
  }

  const originalContent = payload.target === "prd" ? payload.prdContent : payload.uiContent;
  const extracted = findMarkdownSection(
    originalContent,
    payload.sectionTitle,
    payload.sectionOccurrence,
    payload.sectionStartLine
  );
  const prompt = createSectionPrompt({
    instruction: payload.instruction,
    sectionContent: extracted.section,
    sectionTitle: payload.sectionTitle,
    target: payload.target,
  });
  const revision = await runRevisionPrompt(prompt, "revise_section");
  const revisedContent = replaceMarkdownSection({
    ...extracted,
    revisedSection: revision.text,
  });

  return {
    model: revision.model,
    provider: revision.provider,
    prd_content:
      payload.target === "prd"
        ? ensureMarkdownContent(revisedContent, {
            fallback: payload.prdContent,
            title: "PRD",
          })
        : undefined,
    ui_prompt_content:
      payload.target === "ui"
        ? ensureMarkdownContent(revisedContent, {
            fallback: payload.uiContent,
            title: "UI Prompt",
          })
        : undefined,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Gagal merevisi dokumen.";
}

async function runRevisionPrompt(
  prompt: string,
  task: Extract<AiTaskType, "revise_section" | "revise_document">
): Promise<{ model: string; text: string; provider: Provider }> {
  let lastError: unknown = null;
  const maxTokens = task === "revise_section" ? reviseSectionMaxTokens : reviseDocumentMaxTokens;

  for (const provider of getAiProviderOrder(task) as Provider[]) {
    try {
      let rawResponse = "";
      const modelName = getAiModel(task, provider);

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
          temperature: 0.2,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        });

        rawResponse = completion.choices[0]?.message?.content ?? "";
      }

      if (provider === "9router") {
        rawResponse = await createOpenAICompatibleCompletion({
          apiKey: nineRouterApiKey,
          baseUrl: nineRouterBaseUrl,
          maxTokens,
          messages: [{ role: "user", content: prompt }],
          model: modelName,
          temperature: 0.2,
        });
      }

      if (!rawResponse.trim()) {
        throw new Error("Respons revisi kosong.");
      }

      return { model: modelName, text: rawResponse.trim(), provider };
    } catch (error: unknown) {
      lastError = error;
      console.warn(`Provider revisi ${provider} gagal, mencoba fallback...`, error);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Tidak ada penyedia AI yang berhasil untuk revisi.");
}

export async function POST(req: NextRequest) {
  let dedupeHash = "";
  let userForError: Awaited<ReturnType<typeof getAuthenticatedUser>> | null = null;
  let taskForError: Extract<AiTaskType, "revise_section" | "revise_document"> = "revise_document";

  try {
    const user = await getAuthenticatedUser(req);
    userForError = user;
    const payload = (await req.json()) as RevisePayload;

    if (!payload.id || !payload.instruction?.trim()) {
      return NextResponse.json(
        { error: "id and instruction are required." },
        { status: 400 }
      );
    }

    if (!["prd", "ui", "both"].includes(payload.target)) {
      return NextResponse.json({ error: "Invalid target." }, { status: 400 });
    }

    const outputRef = adminDb.collection("outputs").doc(payload.id);
    const outputSnap = await outputRef.get();

    if (!outputSnap.exists) {
      return NextResponse.json({ error: "Dokumen tidak ditemukan." }, { status: 404 });
    }

    const outputData = outputSnap.data() || {};
    const ownerId = outputData.user_id;

    if (ownerId && ownerId !== user.uid) {
      return NextResponse.json({ error: "Kamu tidak punya akses ke dokumen ini." }, { status: 403 });
    }

    await touchUserProfile(user);
    const task: Extract<AiTaskType, "revise_section" | "revise_document"> =
      payload.mode === "section" ? "revise_section" : "revise_document";
    taskForError = task;
    dedupeHash = hashAiRequest({
      endpoint: "/api/revise",
      id: payload.id,
      instruction: payload.instruction.trim(),
      mode: payload.mode || "document",
      sectionOccurrence: payload.sectionOccurrence || 1,
      sectionStartLine: payload.sectionStartLine || null,
      sectionTitle: payload.sectionTitle || null,
      target: payload.target,
      user_id: user.uid,
    });
    const dedupeState = await startAiDedupe(dedupeHash, {
      endpoint: "/api/revise",
      output_id: payload.id,
      task_type: task,
      user_id: user.uid,
    });

    if (dedupeState.status === "completed") {
      await recordAiUsage({
        endpoint: "/api/revise",
        inputText: payload.instruction,
        outputText: "",
        status: "cached",
        task,
        user,
      });

      return NextResponse.json(dedupeState.response);
    }

    if (dedupeState.status === "processing") {
      return NextResponse.json(
        { error: "Revisi sedang diproses. Tunggu sebentar sebelum mencoba lagi." },
        { status: 409 }
      );
    }

    await assertAndConsumeDailyQuota(user, task);
    const currentVersion = typeof outputData.version === "number" ? outputData.version : 1;
    const nextVersion = currentVersion + 1;
    const versionId = `v${nextVersion}`;

    if (payload.mode === "section") {
      const revision = await reviseSingleSection(payload);
      const nextPrdContent = revision.prd_content || payload.prdContent;
      const nextUiPromptContent = revision.ui_prompt_content || payload.uiContent;
      const updateData: Record<string, unknown> = {
        last_revised_by: user.uid,
        revision_mode: "section",
        revision_target: payload.target,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        version: nextVersion,
      };

      if (revision.prd_content) {
        updateData.prd_content = revision.prd_content;
      }

      if (revision.ui_prompt_content) {
        updateData.ui_prompt_content = revision.ui_prompt_content;
      }

      await outputRef.update(updateData);
      await outputRef.collection("versions").doc(versionId).set({
        prd_content: nextPrdContent,
        revision_mode: "section",
        revision_target: payload.target,
        section_title: payload.sectionTitle || null,
        ui_prompt_content: nextUiPromptContent,
        user_id: user.uid,
        version: nextVersion,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      const response: Record<string, unknown> = {
        success: true,
        provider: revision.provider,
        version: nextVersion,
        version_id: versionId,
      };

      if (revision.prd_content) {
        response.prd_content = revision.prd_content;
      }

      if (revision.ui_prompt_content) {
        response.ui_prompt_content = revision.ui_prompt_content;
      }

      await completeAiDedupe(dedupeHash, response);
      await recordAiUsage({
        endpoint: "/api/revise",
        inputText: `${payload.instruction}\n\n${payload.sectionTitle || ""}`,
        model: revision.model,
        outputText: revision.prd_content || revision.ui_prompt_content || "",
        provider: revision.provider as AiProvider,
        status: "success",
        task,
        user,
      });

      return NextResponse.json(response);
    }

    const prompt = createPrompt(payload);
    const revision = await runRevisionPrompt(prompt, "revise_document");

    const parsed = parseDelimitedDocuments(revision.text);

    const prd_content = ensureMarkdownContent(parsed.prd_content, {
      fallback: payload.prdContent,
      title: "PRD",
    });
    const ui_prompt_content = ensureMarkdownContent(parsed.ui_prompt_content, {
      fallback: payload.uiContent,
      title: "UI Prompt",
    });

    await outputRef.update({
      prd_content,
      ui_prompt_content,
      last_revised_by: user.uid,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      version: nextVersion,
    });
    await outputRef.collection("versions").doc(versionId).set({
      prd_content,
      revision_mode: "document",
      revision_target: payload.target,
      ui_prompt_content,
      user_id: user.uid,
      version: nextVersion,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const response = {
      success: true,
      provider: revision.provider,
      prd_content,
      ui_prompt_content,
      version: nextVersion,
      version_id: versionId,
    };

    await completeAiDedupe(dedupeHash, response);
    await recordAiUsage({
      endpoint: "/api/revise",
      inputText: payload.instruction,
      model: revision.model,
      outputText: `${prd_content}\n\n${ui_prompt_content}`,
      provider: revision.provider as AiProvider,
      status: "success",
      task,
      user,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("Galat API revisi", error);
    if (dedupeHash) {
      await failAiDedupe(dedupeHash, error);
    }

    if (userForError) {
      await recordAiError({
        endpoint: "/api/revise",
        error,
        task: taskForError,
        user: userForError,
      });
    }

    if (isUnauthenticatedError(error)) {
      return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });
    }

    const message = getErrorMessage(error);

    return NextResponse.json(
      { error: message || "Gagal merevisi dokumen." },
      { status: error && typeof error === "object" && "status" in error ? Number(error.status) || 500 : 500 }
    );
  }
}
