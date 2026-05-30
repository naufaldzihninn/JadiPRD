"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getClientDb } from "@/lib/firebase/config";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardList,
  Layers3,
  Loader2,
  Send,
  Sparkles,
  Target,
  User,
} from "lucide-react";

type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
};

const briefSections = [
  { label: "Masalah", icon: Target },
  { label: "Pengguna", icon: User },
  { label: "Cakupan", icon: Layers3 },
  { label: "Kebutuhan", icon: ClipboardList },
];

const checklist = [
  "Konteks masalah",
  "Target pengguna",
  "Batas MVP",
  "Kriteria sukses",
  "Petunjuk model data",
];

const defaultSuggestions = [
  "Kasir dan stok untuk UMKM",
  "Marketplace jasa lokal",
  "Dashboard operasional internal",
];

type SuggestionTopic =
  | "design"
  | "feature"
  | "generate"
  | "idea"
  | "platform"
  | "problem"
  | "success"
  | "target"
  | "tech"
  | "timeline"
  | "unknown";

const suggestionsByTopic: Record<SuggestionTopic, string[]> = {
  idea: defaultSuggestions,
  problem: [
    "🧾 Pencatatan masih manual",
    "📦 Stok sering tidak akurat",
    "⏱️ Laporan makan waktu",
    "🤖 AI bantu rumuskan masalah",
  ],
  target: [
    "👤 Pemilik bisnis",
    "👥 Kasir / staf operasional",
    "🛒 Pelanggan juga",
    "🤖 AI bantu susun role",
  ],
  feature: [
    "🤖 AI bantu prioritaskan",
    "📦 Manajemen data",
    "📊 Laporan otomatis",
    "🔔 Notifikasi penting",
  ],
  platform: [
    "🤖 AI pilih yang paling cocok",
    "🌐 Web dashboard",
    "📱 Mobile app",
    "🔁 Hybrid web + mobile",
  ],
  tech: [
    "🤖 AI pilih rekomendasi terbaik",
    "⚡ Next.js + Supabase",
    "🔥 Firebase + React",
    "🧱 Laravel + MySQL",
  ],
  design: [
    "🤖 AI pilih arah visual terbaik",
    "🏢 SaaS netral profesional",
    "🌿 Hangat dan mudah didekati",
    "⚫ Gelap, fokus, dan premium",
  ],
  timeline: ["🏃 Cepat 3-5 hari", "📦 MVP 1-2 minggu", "🚀 Versi lengkap 1 bulan+"],
  success: [
    "✅ Transaksi lebih cepat",
    "📉 Selisih stok berkurang",
    "📊 Laporan siap tiap hari",
    "🤖 AI bantu tentukan metrik",
  ],
  generate: ["✅ Ya, buat PRD sekarang", "✏️ Revisi ringkasan dulu", "➕ Tambahkan detail lagi"],
  unknown: ["✍️ Jawab bebas", "🤖 AI bantu pilihkan", "➕ Tambahkan konteks"],
};

function stripSuggestionHints(text: string) {
  return text
    .replace(/(?:^|\n)\s*(?:SUGGESTIONS|SARAN|PILIHAN|OPSI)\s*:\s*([^\n]+)/gi, "")
    .trim();
}

function getLatestPromptText(message: string) {
  const normalized = stripSuggestionHints(message)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const questionEnd = normalized.lastIndexOf("?");

  if (questionEnd === -1) {
    return normalized.split(/\n{2,}/).filter(Boolean).at(-1) || normalized;
  }

  const beforeQuestion = normalized.slice(0, questionEnd + 1);
  const lowerBeforeQuestion = beforeQuestion.toLowerCase();
  const paragraphs = beforeQuestion
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const questionParagraph =
    [...paragraphs].reverse().find((paragraph) => paragraph.includes("?")) ||
    paragraphs.at(-1) ||
    beforeQuestion;
  const questionParagraphStart = beforeQuestion.lastIndexOf(questionParagraph);
  const flowMarkers = [
    "sekarang,",
    "pertanyaan selanjutnya",
    "berikut pertanyaan selanjutnya",
    "mari kita tanya",
    "berikutnya,",
    "selanjutnya,",
    "terakhir,",
    "untuk lanjut,",
    "supaya lanjut,",
  ];
  const markerIndex = flowMarkers.reduce((latestIndex, marker) => {
    const index = lowerBeforeQuestion.lastIndexOf(marker);
    return index > latestIndex ? index : latestIndex;
  }, -1);

  if (markerIndex >= questionParagraphStart && markerIndex >= 0) {
    return beforeQuestion.slice(markerIndex).trim();
  }

  return questionParagraph.trim();
}

function getQuestionSentences(text: string) {
  return (
    text
      .replace(/\s+/g, " ")
      .match(/[^.!?]*\?+/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) || []
  );
}

function getActiveQuestionText(message: string) {
  const promptText = getLatestPromptText(message);
  const questions = getQuestionSentences(promptText);

  if (questions.length > 0) {
    return questions.at(-1) || promptText;
  }

  const sentenceStart = Math.max(
    promptText.lastIndexOf(". "),
    promptText.lastIndexOf("! "),
    promptText.lastIndexOf("? "),
  );

  if (sentenceStart >= 0) {
    return promptText.slice(sentenceStart + 2).trim();
  }

  return promptText;
}

function promptIncludes(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function classifyActiveQuestion(text: string): SuggestionTopic {
  const cleanText = text.replace(/\s+/g, " ").trim().toLowerCase();

  if (!cleanText) {
    return "unknown";
  }

  if (
    promptIncludes(cleanText, [
      "mau bikin aplikasi",
      "mau buat aplikasi",
      "aplikasi seperti apa",
      "ceritain idemu",
      "ide produk",
      "produk apa",
      "mau dibuat",
    ])
  ) {
    return "idea";
  }

  if (
    /(?:siap|setuju|oke|ok).{0,80}(?:buat|membuat|generate|susun).{0,20}prd/i.test(cleanText) ||
    /(?:buat|membuat|generate|susun).{0,20}prd.{0,80}(?:sekarang|pertama|final|siap)/i.test(cleanText) ||
    /(?:apakah|apa).{0,80}(?:siap|mau).{0,80}(?:prd|dokumen)/i.test(cleanText)
  ) {
    return "generate";
  }

  if (
    promptIncludes(cleanText, [
      "masalah utama",
      "problem utama",
      "kendala utama",
      "tantangan utama",
      "pain point",
      "ingin diselesaikan",
      "ingin kamu selesaikan",
      "paling ingin kamu selesaikan",
      "apa yang ingin",
      "apa yang paling",
      "mengurangi kesalahan",
      "memperbaiki",
    ])
  ) {
    return "problem";
  }

  if (
    promptIncludes(cleanText, [
      "siapa target",
      "target pengguna",
      "siapa pengguna",
      "siapa saja pengguna",
      "untuk siapa",
      "siapa yang akan",
      "siapa yang memakai",
      "pengguna dari",
      "role pengguna",
      "peran pengguna",
      "anda sendiri",
      "kamu sendiri",
      "karyawan lainnya",
      "para pelanggan",
    ])
  ) {
    return "target";
  }

  if (
    promptIncludes(cleanText, [
      "fitur",
      "fitur apa",
      "fitur utama",
      "fitur paling",
      "prioritas fitur",
      "fitur mvp",
      "cakupan mvp",
      "cakupan",
      "scope",
      "mvp",
      "mvp scope",
      "kebutuhan utama",
      "requirement",
      "yang paling penting",
      "yang perlu diprioritaskan",
    ])
  ) {
    return "feature";
  }

  if (
    promptIncludes(cleanText, [
      "platform",
      "platform mana",
      "platform apa",
      "diakses melalui",
      "akses melalui",
      "akses via",
      "dibuka lewat",
      "web atau mobile",
      "mobile atau web",
      "perangkat apa",
      "hp atau desktop",
      "tablet",
      "pwa",
    ])
  ) {
    return "platform";
  }

  if (
    promptIncludes(cleanText, [
      "teknologi",
      "tech stack",
      "stack",
      "framework",
      "bahasa pemrograman",
      "database",
      "frontend",
      "front-end",
      "backend",
      "back-end",
      "react",
      "next.js",
      "supabase",
      "firebase",
      "laravel",
      "mysql",
    ])
  ) {
    return "tech";
  }

  if (
    promptIncludes(cleanText, [
      "arah visual",
      "preferensi visual",
      "warna",
      "color",
      "palet",
      "palette",
      "desain",
      "visual",
      "brand",
      "tampilan",
      "nuansa",
      "tema",
      "gaya",
      "ui",
    ])
  ) {
    return "design";
  }

  if (
    promptIncludes(cleanText, [
      "berapa lama",
      "target waktu",
      "estimasi waktu",
      "waktu pengerjaan",
      "timeline",
      "deadline",
      "target rilis",
    ])
  ) {
    return "timeline";
  }

  if (
    promptIncludes(cleanText, [
      "kriteria sukses",
      "metrik",
      "indikator",
      "ukuran berhasil",
      "dianggap berhasil",
      "acceptance",
      "diterima",
    ])
  ) {
    return "success";
  }

  return "unknown";
}

function getSuggestionTopic(message: string): SuggestionTopic {
  const activeQuestionText = getActiveQuestionText(message);
  const activeQuestionTopic = classifyActiveQuestion(activeQuestionText);

  if (activeQuestionTopic !== "unknown") {
    return activeQuestionTopic;
  }

  const promptQuestionTopic = classifyActiveQuestion(getLatestPromptText(message));

  if (promptQuestionTopic !== "unknown") {
    return promptQuestionTopic;
  }

  return "unknown";
}

function getFallbackSuggestions(message: string, _turnCount: number) {
  const topic = getSuggestionTopic(message);

  if (!message.trim()) {
    return suggestionsByTopic.idea;
  }

  return suggestionsByTopic[topic] || suggestionsByTopic.unknown;
}

function parseSuggestions(replyText: string) {
  return { cleanedReply: stripSuggestionHints(replyText), suggestions: [] };
}

function isGenerateSuggestion(suggestion: string) {
  const text = suggestion.toLowerCase();

  return (
    text.includes("buat") &&
    text.includes("prd") &&
    !text.includes("ubah") &&
    !text.includes("revisi") &&
    !text.includes("edit")
  );
}

export default function InterviewPage() {
  const router = useRouter();
  const { getIdToken, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "ai",
      content: "Halo! Aku asisten AI dari JadiPRD. Ceritain idemu dong, mau bikin aplikasi seperti apa?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>(defaultSuggestions);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(2);
  const sessionIdRef = useRef("");

  const progress = Math.min(100, Math.max(12, messages.length * 12));

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const createMessageId = () => {
    const id = `message-${messageIdRef.current}`;
    messageIdRef.current += 1;
    return id;
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, suggestions]);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      return;
    }

    const selectedSessionId = new URLSearchParams(window.location.search).get("session");

    if (!selectedSessionId) {
      return;
    }

    const sessionToLoad = selectedSessionId;
    const userId = user.uid;

    async function loadSession() {
      setIsLoadingSession(true);

      try {
        const db = getClientDb();
        const sessionRef = doc(db, "interview_sessions", sessionToLoad);
        const sessionSnap = await getDoc(sessionRef);

        if (!sessionSnap.exists()) {
          return;
        }

        const data = sessionSnap.data();

        if (data.user_id !== userId || !Array.isArray(data.messages)) {
          return;
        }

        const loadedMessages = data.messages
          .filter((message: Partial<Message>) => (
            (message.role === "user" || message.role === "ai") &&
            typeof message.content === "string"
          ))
          .map((message: Partial<Message>, index: number) => ({
            id: typeof message.id === "string" ? message.id : `message-${index + 1}`,
            role: message.role,
            content: message.content,
          })) as Message[];

        if (loadedMessages.length > 0) {
          setMessages(loadedMessages);
          messageIdRef.current = loadedMessages.length + 1;
          setSuggestions(getFallbackSuggestions(loadedMessages.at(-1)?.content || "", loadedMessages.length));
        }

        setSessionId(sessionToLoad);
        sessionIdRef.current = sessionToLoad;
      } catch (error) {
        console.error("Gagal memuat sesi wawancara", error);
      } finally {
        setIsLoadingSession(false);
      }
    }

    loadSession();
  }, [user]);

  const persistSession = async (
    nextMessages: Message[],
    options: { outputId?: string; status?: "draft" | "generating" | "generated" } = {}
  ) => {
    if (!user || nextMessages.length === 0) {
      return sessionId;
    }

    const firstUserMessage = nextMessages.find((message) => message.role === "user");
    const title =
      firstUserMessage?.content.slice(0, 72) ||
      nextMessages[0]?.content.slice(0, 72) ||
      "Wawancara baru";
    const payload = {
      last_message: nextMessages.at(-1)?.content.slice(0, 180) || "",
      message_count: nextMessages.length,
      messages: nextMessages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
      })),
      output_id: options.outputId || null,
      status: options.status || "draft",
      title,
      updated_at: serverTimestamp(),
      user_email: user.email,
      user_id: user.uid,
      user_name: user.displayName,
      user_photo_url: user.photoURL,
    };

    const activeSessionId = sessionIdRef.current || sessionId;
    const db = getClientDb();

    if (activeSessionId) {
      await setDoc(doc(db, "interview_sessions", activeSessionId), payload, { merge: true });
      return activeSessionId;
    }

    const sessionRef = await addDoc(collection(db, "interview_sessions"), {
      ...payload,
      created_at: serverTimestamp(),
    });
    setSessionId(sessionRef.id);
    sessionIdRef.current = sessionRef.id;
    window.history.replaceState(null, "", `/interview?session=${sessionRef.id}`);
    return sessionRef.id;
  };

  const safePersistSession = async (
    nextMessages: Message[],
    options: { outputId?: string; status?: "draft" | "generating" | "generated" } = {}
  ) => {
    try {
      return await persistSession(nextMessages, options);
    } catch (error) {
      console.error("Gagal menyimpan sesi wawancara", error);
      return sessionIdRef.current || sessionId;
    }
  };

  const sendPayload = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: text.trim(),
    };

    const messagesWithUser = [...messages, userMessage];

    setMessages(messagesWithUser);
    setInput("");
    setSuggestions([]);
    setIsLoading(true);

    try {
      await safePersistSession(messagesWithUser, { status: "draft" });
      const token = await getIdToken();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messagesWithUser,
        }),
      });

      if (!response.ok) throw new Error("Gagal mengambil respon dari AI");

      const data = await response.json();
      const { cleanedReply } = parseSuggestions(data.reply);
      const newSuggestions = getFallbackSuggestions(cleanedReply, messagesWithUser.length + 1);

      setSuggestions(newSuggestions);

      const aiMessage: Message = {
        id: createMessageId(),
        role: "ai",
        content: cleanedReply,
      };
      const messagesWithReply = [...messagesWithUser, aiMessage];

      setMessages(messagesWithReply);
      await safePersistSession(messagesWithReply, { status: "draft" });
    } catch (error) {
      console.error(error);
      const errorMessage: Message = {
        id: createMessageId(),
        role: "ai",
        content: "Maaf, terjadi kesalahan saat menghubungi AI. Coba lagi ya.",
      };
      const messagesWithError = [...messagesWithUser, errorMessage];

      setMessages(messagesWithError);
      await safePersistSession(messagesWithError, { status: "draft" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendPayload(input);
  };

  const handleGenerate = async (confirmedMessage?: Message) => {
    if (isLoading || isGenerating) return;

    const generationMessages = confirmedMessage ? [...messages, confirmedMessage] : messages;

    setIsGenerating(true);
    setIsLoading(true);
    setSuggestions([]);
    const generatingMessages: Message[] = [
      ...generationMessages.filter((m) => m.id !== "generating"),
      { id: "generating", role: "ai", content: "Baik, sedang menyusun PRD dan UI Prompt berdasarkan obrolan kita..." },
    ];
    setMessages(generatingMessages);
    try {
      const currentSessionId = await safePersistSession(generationMessages, { status: "generating" });
      const token = await getIdToken();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: generationMessages, session_id: currentSessionId }),
      });
      const data = await res.json();
      if (data.success) {
        await safePersistSession(generationMessages, {
          outputId: data.output_id,
          status: "generated",
        });
        router.push(`/result/${data.output_id}`);
      } else if (res.status === 409) {
        await safePersistSession(generationMessages, { status: "generating" });
        router.push("/dashboard");
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Gagal membuat PRD.");
      await safePersistSession(generationMessages, { status: "draft" });
      setIsLoading(false);
      setIsGenerating(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (isGenerateSuggestion(suggestion)) {
      const userMessage: Message = {
        id: createMessageId(),
        role: "user",
        content: suggestion,
      };

      handleGenerate(userMessage);
      return;
    }

    setInput((prev) => (prev ? `${prev}, ${suggestion}` : suggestion));
  };

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-[#f7f4ed] text-[#26251e] dark:bg-[#08090a] dark:text-[#f7f8f8]">
      <header className="flex shrink-0 items-center justify-between border-b border-[#ddd7ca] bg-[#f7f4ed]/92 px-5 py-4 backdrop-blur dark:border-[#2b2d31] dark:bg-[#08090a]/90 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="text-[#7a7974] hover:bg-[#ece8de] hover:text-[#26251e] dark:text-[#8a8f98] dark:hover:bg-[#17181b] dark:hover:text-[#f7f8f8]">
              <ArrowLeft size={20} />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles size={18} className="text-[#d6ae1f] dark:text-[#f4d13d]" />
              Wawancara AI
            </h1>
            <p className="truncate text-sm text-[#7a7974] dark:text-[#8a8f98]">Susun ringkasan produk sebelum dokumen dibuat</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UserMenu />
          <Button
            variant="outline"
            className="h-10 border-[#d6ae1f] bg-transparent px-4 text-[#d6ae1f] hover:bg-[#fff7d6] dark:border-[#f4d13d] dark:text-[#f4d13d] dark:hover:bg-[#2a2411]"
            disabled={messages.length < 5 || isLoading || isGenerating || isLoadingSession}
            onClick={() => handleGenerate()}
          >
            {isGenerating ? "Membuat..." : "Buat PRD"}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[1fr_360px]">
        <main className="flex min-h-0 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
            <div className="mx-auto max-w-3xl space-y-5">
              {isLoadingSession && (
                <div className="flex items-center gap-2 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] px-4 py-3 text-sm text-[#7a7974] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#8a8f98]">
                  <Loader2 size={16} className="animate-spin" />
                  Memuat riwayat wawancara...
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    msg.role === "user"
                      ? "bg-[#26251e] text-[#f7f4ed] dark:bg-[#f4d13d] dark:text-[#08090a]"
                      : "border border-[#ddd7ca] bg-[#fffcf6] text-[#d6ae1f] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#f4d13d]"
                  }`}>
                    {msg.role === "user" ? <User size={15} /> : <Bot size={15} />}
                  </div>
                  <div className={`max-w-[82%] rounded-lg px-4 py-3 shadow-sm ${
                    msg.role === "user"
                      ? "bg-[#26251e] text-[#f7f4ed] dark:bg-[#f4d13d] dark:text-[#08090a]"
                      : "border border-[#ddd7ca] bg-[#fffcf6] text-[#26251e] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#f7f8f8]"
                  }`}>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#ddd7ca] bg-[#fffcf6] text-[#d6ae1f] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#f4d13d]">
                    <Bot size={15} />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] px-4 py-3 dark:border-[#2b2d31] dark:bg-[#111214]">
                    <Loader2 size={16} className="animate-spin text-[#7a7974] dark:text-[#8a8f98]" />
                    <span className="text-[15px] text-[#7a7974] dark:text-[#8a8f98]">
                      {isGenerating ? "Dokumen sedang dibuat..." : "AI sedang berpikir..."}
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <footer className="shrink-0 border-t border-[#ddd7ca] bg-[#f7f4ed]/95 p-4 backdrop-blur dark:border-[#2b2d31] dark:bg-[#08090a]/95">
            <div className="mx-auto max-w-3xl space-y-3">
              {suggestions.length > 0 && !isLoading && !isGenerating && (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="rounded-full border border-[#ead58a] bg-[#fff7d6] px-3 py-1.5 text-sm text-[#6f5600] transition-colors hover:bg-[#ffefb0] dark:border-[#4a3d16] dark:bg-[#2a2411] dark:text-[#f4d13d] dark:hover:bg-[#3a3116]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Tulis jawaban, batasan, target pengguna, atau cakupan MVP..."
                  className="h-11 flex-1 rounded-full border-[#d8d0c0] bg-[#fffcf6] px-4 text-[#26251e] focus-visible:ring-[#d6ae1f] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#f7f8f8] dark:focus-visible:ring-[#f4d13d]"
                  disabled={isLoading || isGenerating}
                />
                <Button type="submit" disabled={!input.trim() || isLoading || isGenerating} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#26251e] p-0 text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]">
                  <Send size={16} />
                </Button>
              </form>
            </div>
          </footer>
        </main>

        <aside className="hidden min-h-0 border-l border-[#ddd7ca] bg-[#f0ece3] p-5 dark:border-[#2b2d31] dark:bg-[#0f1011] xl:block">
          <div className="rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-5 dark:border-[#2b2d31] dark:bg-[#111214]">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Cakupan ringkasan</h2>
              <span className="font-mono text-xs text-[#7a7974] dark:text-[#8a8f98]">{progress}%</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#ece8de] dark:bg-[#08090a]">
              <div className="h-full rounded-full bg-[#d6ae1f] dark:bg-[#f4d13d]" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-5 space-y-3">
              {briefSections.map(({ label, icon: Icon }, index) => {
                const active = messages.length > index + 1;
                return (
                  <div key={label} className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      active
                        ? "bg-[#fff7d6] text-[#d6ae1f] dark:bg-[#2a2411] dark:text-[#f4d13d]"
                        : "bg-[#f7f4ed] text-[#9b978e] dark:bg-[#08090a] dark:text-[#62666d]"
                    }`}>
                      <Icon size={15} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-[#7a7974] dark:text-[#8a8f98]">{active ? "Sudah tergali di obrolan" : "Menunggu detail"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-5 dark:border-[#2b2d31] dark:bg-[#111214]">
            <h2 className="font-semibold">Daftar cek pembuatan</h2>
            <div className="mt-4 space-y-3">
              {checklist.map((item, index) => {
                const done = messages.length > index + 2;
                return (
                  <div key={item} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 size={16} className={done ? "text-[#d6ae1f] dark:text-[#f4d13d]" : "text-[#b5afa4] dark:text-[#62666d]"} />
                    <span className={done ? "" : "text-[#7a7974] dark:text-[#8a8f98]"}>{item}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
    </ProtectedRoute>
  );
}
