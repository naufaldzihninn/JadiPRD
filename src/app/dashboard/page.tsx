"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand/BrandMark";
import { getClientDb } from "@/lib/firebase/config";
import {
  ArrowRight,
  Bot,
  Calendar,
  FileText,
  LayoutDashboard,
  Loader2,
  PlusCircle,
  Search,
} from "lucide-react";

interface OutputDocument {
  ai_model?: string;
  ai_provider?: string;
  created_at?: { seconds?: number };
  id: string;
  product_name?: string;
  prd_content?: string;
  project_id?: string;
  title?: string;
  updated_at?: { seconds?: number };
  ui_prompt_content?: string;
  version?: number;
}

interface InterviewSession {
  created_at?: { seconds?: number };
  id: string;
  last_message?: string;
  message_count?: number;
  output_id?: string | null;
  status?: "draft" | "generating" | "generated";
  title?: string;
  updated_at?: { seconds?: number };
}

type DashboardView = "home" | "documents";

const navItems = [
  { icon: LayoutDashboard, id: "home" as const, label: "Beranda" },
  { icon: FileText, id: "documents" as const, label: "Dokumen" },
];

function getDocumentTitle(document: OutputDocument) {
  const savedTitle = cleanDocumentTitle(document.title || document.product_name || "");

  if (savedTitle) {
    return savedTitle;
  }

  const labeledTitle = document.prd_content?.match(
    /^\s*(?:[-*]\s*)?(?:\*\*)?(?:Nama Produk|Nama Aplikasi|Nama Project|Nama Proyek|Product Name|Project Name|Judul Produk)(?:\*\*)?\s*[:：]\s*(?:\*\*)?(.+)$/im
  )?.[1];
  const cleanLabeledTitle = cleanDocumentTitle(labeledTitle || "");

  if (cleanLabeledTitle) {
    return cleanLabeledTitle;
  }

  const heading = document.prd_content?.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const cleanHeading = cleanDocumentTitle(heading?.replace(/^PRD\s*[—-]\s*/i, "") || "");

  if (cleanHeading) {
    return cleanHeading;
  }

  return `Dokumen PRD ${document.id.slice(0, 6)}`;
}

function cleanDocumentTitle(title: string) {
  const clean = title
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/g, "")
    .trim();

  if (
    !clean ||
    /^(prd|product requirements document|project requirements document|dokumen prd)$/i.test(
      clean
    )
  ) {
    return "";
  }

  return clean.slice(0, 90);
}

function formatDate(seconds?: number) {
  if (!seconds) {
    return "Belum ada tanggal";
  }

  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(seconds * 1000));
}

function DashboardContent() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<OutputDocument[]>([]);
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [docsError, setDocsError] = useState("");
  const [activeView, setActiveView] = useState<DashboardView>("home");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    const userId = user.uid;

    async function loadDocuments() {
      setIsLoadingDocs(true);
      setDocsError("");

      try {
        const db = getClientDb();
        const docsQuery = query(
          collection(db, "outputs"),
          where("user_id", "==", userId)
        );
        const sessionsQuery = query(
          collection(db, "interview_sessions"),
          where("user_id", "==", userId)
        );
        const [outputsSnapshot, sessionsSnapshot] = await Promise.all([
          getDocs(docsQuery),
          getDocs(sessionsQuery),
        ]);
        const loadedDocuments = outputsSnapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<OutputDocument, "id">) }))
          .sort((a, b) => {
            const aTime = a.updated_at?.seconds || a.created_at?.seconds || 0;
            const bTime = b.updated_at?.seconds || b.created_at?.seconds || 0;
            return bTime - aTime;
          });
        const loadedSessions = sessionsSnapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<InterviewSession, "id">) }))
          .sort((a, b) => {
            const aTime = a.updated_at?.seconds || a.created_at?.seconds || 0;
            const bTime = b.updated_at?.seconds || b.created_at?.seconds || 0;
            return bTime - aTime;
          });

        setDocuments(loadedDocuments);
        setSessions(loadedSessions);
      } catch (error) {
        console.error("Gagal mengambil riwayat dokumen", error);
        setDocsError("Gagal memuat riwayat dokumen. Cek Firestore rules atau koneksi.");
      } finally {
        setIsLoadingDocs(false);
      }
    }

    loadDocuments();
  }, [user]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredDocuments = useMemo(() => {
    if (!normalizedSearchQuery) {
      return documents;
    }

    return documents.filter((document) => {
      const searchableTitle = getDocumentTitle(document).toLowerCase();

      return searchableTitle.includes(normalizedSearchQuery);
    });
  }, [documents, normalizedSearchQuery]);
  const displayedDocuments =
    activeView === "documents" || normalizedSearchQuery
      ? filteredDocuments
      : filteredDocuments.slice(0, 5);
  const latestDocument = documents[0] || null;
  const hasGeneratedDocument = Boolean(latestDocument);
  const primaryCtaHref = latestDocument ? `/result/${latestDocument.id}` : "/interview";
  const primaryCtaLabel = latestDocument ? "Buka PRD" : "Buat PRD";
  const draftSessions = hasGeneratedDocument
    ? []
    : sessions
        .filter((session) => session.status !== "generated" || !session.output_id)
        .slice(0, 4);
  const stats = useMemo(
    () => [
      { label: "Dokumen", value: String(documents.length), detail: "Milik akun ini" },
      { label: "Wawancara", value: String(sessions.length), detail: "Riwayat chat" },
      {
        label: "Revisi",
        value: String(
          documents.reduce((total, document) => total + Math.max((document.version || 1) - 1, 0), 0)
        ),
        detail: "Total iterasi",
      },
    ],
    [documents, sessions.length]
  );

  return (
    <div className="min-h-screen bg-[#f7f4ed] text-[#26251e] dark:bg-[#08090a] dark:text-[#f7f8f8]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1500px] lg:grid-cols-[248px_1fr]">
        <aside className="hidden border-r border-[#ddd7ca] bg-[#f0ece3] px-4 py-5 dark:border-[#2b2d31] dark:bg-[#0f1011] lg:block">
          <Link href="/" className="flex items-center gap-3 px-1">
            <BrandMark size={40} />
            <div>
              <p className="font-semibold leading-none">
                Jadi<span className="text-[#d6ae1f] dark:text-[#f4d13d]">PRD</span>
              </p>
              <p className="mt-1 text-xs text-[#7a7974] dark:text-[#8a8f98]">
                Dari ide jadi <span className="text-[#d6ae1f] dark:text-[#f4d13d]">PRD</span>
              </p>
            </div>
          </Link>

          <nav className="mt-8 space-y-1">
            {navItems.map(({ icon: Icon, id, label }) => (
              <button
                key={label}
                type="button"
                onClick={() => setActiveView(id)}
                className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${
                  activeView === id
                    ? "bg-[#26251e] text-[#f7f4ed] dark:bg-[#f4d13d] dark:text-[#08090a]"
                    : "text-[#5f5d56] hover:bg-[#e8e1d5] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
            <Link
              href={primaryCtaHref}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#5f5d56] transition hover:bg-[#e8e1d5] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
            >
              {hasGeneratedDocument ? <FileText size={16} /> : <Bot size={16} />}
              {hasGeneratedDocument ? "Buka PRD" : "Wawancara AI"}
            </Link>
          </nav>

          <Link href={primaryCtaHref} className="mt-8 block">
            <Button className="h-9 w-full bg-[#26251e] text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]">
              {primaryCtaLabel} <ArrowRight size={16} />
            </Button>
          </Link>
        </aside>

        <main id="beranda" className="min-w-0">
          <header className="flex items-center justify-between border-b border-[#ddd7ca] bg-[#f7f4ed]/92 px-5 py-4 backdrop-blur dark:border-[#2b2d31] dark:bg-[#08090a]/90 md:px-8">
            <div>
              <p className="text-xs font-semibold uppercase text-[#7a7974] dark:text-[#8a8f98]">
                Dashboard
              </p>
              <h1 className="mt-1 text-2xl font-semibold">Dashboard PRD</h1>
            </div>
            <div className="flex items-center gap-2">
              <UserMenu />
              <label className="hidden h-10 items-center gap-2 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] px-3 text-sm text-[#7a7974] transition focus-within:border-[#d6ae1f] focus-within:ring-2 focus-within:ring-[#d6ae1f]/20 dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#8a8f98] dark:focus-within:border-[#f4d13d] dark:focus-within:ring-[#f4d13d]/20 sm:flex">
                <Search size={16} />
                <input
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    if (event.target.value.trim()) {
                      setActiveView("documents");
                    }
                  }}
                  placeholder="Cari dokumen"
                  className="w-36 bg-transparent text-[#26251e] outline-none placeholder:text-[#7a7974] dark:text-[#f7f8f8] dark:placeholder:text-[#8a8f98]"
                  type="search"
                />
              </label>
              <Link href={primaryCtaHref}>
                <Button className="h-10 bg-[#26251e] px-4 text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]">
                  {hasGeneratedDocument ? <FileText size={17} /> : <PlusCircle size={17} />}
                  {primaryCtaLabel}
                </Button>
              </Link>
            </div>
          </header>

          <div className="space-y-5 px-5 py-6 md:px-8">
            {activeView === "home" && (
              <>
            <section className="flex flex-col gap-4 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-5 dark:border-[#2b2d31] dark:bg-[#111214] md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">
                  {hasGeneratedDocument ? "Lanjutkan pekerjaanmu" : "Mulai dokumen pertamamu"}
                </h2>
                <p className="mt-1 text-sm text-[#7a7974] dark:text-[#8a8f98]">
                  {hasGeneratedDocument
                    ? "Akun ini sudah punya PRD. Buka dokumen terakhir untuk lanjut revisi."
                    : "Wawancara singkat akan menghasilkan PRD dan UI Prompt."}
                </p>
              </div>
              <Link href={primaryCtaHref} className="shrink-0">
                <Button className="h-10 bg-[#26251e] px-4 text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]">
                  {hasGeneratedDocument ? "Buka dokumen" : "Buat PRD"} <ArrowRight size={16} />
                </Button>
              </Link>
            </section>

            <section className="grid gap-3 md:grid-cols-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-[#ddd7ca] bg-[#fffcf6] px-4 py-3 dark:border-[#2b2d31] dark:bg-[#111214]">
                  <p className="text-xs text-[#7a7974] dark:text-[#8a8f98]">{stat.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{stat.value}</p>
                </div>
              ))}
            </section>
              </>
            )}

            <section id="dokumen" className="rounded-lg border border-[#ddd7ca] bg-[#fffcf6] dark:border-[#2b2d31] dark:bg-[#111214]">
              <div className="flex items-center justify-between border-b border-[#ddd7ca] px-5 py-4 dark:border-[#2b2d31]">
                <div>
                  <h2 className="font-semibold">Dokumen</h2>
                  <p className="mt-1 text-sm text-[#7a7974] dark:text-[#8a8f98]">
                    PRD dan UI Prompt milik akun ini.
                  </p>
                </div>
                <Link href={primaryCtaHref}>
                  <Button variant="outline" className="h-9 border-[#ddd7ca] dark:border-[#2b2d31]">
                    {hasGeneratedDocument ? "Buka terbaru" : "Baru"} <ArrowRight size={15} />
                  </Button>
                </Link>
              </div>

              {isLoadingDocs ? (
                <div className="flex items-center gap-2 p-5 text-sm text-[#7a7974] dark:text-[#8a8f98]">
                  <Loader2 size={16} className="animate-spin" />
                  Memuat dokumen...
                </div>
              ) : docsError ? (
                <div className="m-5 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">
                  {docsError}
                </div>
              ) : displayedDocuments.length ? (
                <div className="divide-y divide-[#e4ded2] dark:divide-[#2b2d31]">
                  {displayedDocuments.map((document) => (
                    <Link
                      key={document.id}
                      href={`/result/${document.id}`}
                      className="flex flex-col gap-3 px-5 py-4 transition hover:bg-[#f7f4ed] dark:hover:bg-[#17181b] md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{getDocumentTitle(document)}</p>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#7a7974] dark:text-[#8a8f98]">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={13} />
                            {formatDate(document.updated_at?.seconds || document.created_at?.seconds)}
                          </span>
                          <span>v{document.version || 1}</span>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-[#d6ae1f] dark:text-[#f4d13d]">
                        Buka <ArrowRight size={15} />
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[#fff7d6] text-[#d6ae1f] dark:bg-[#2a2411] dark:text-[#f4d13d]">
                    <FileText size={18} />
                  </div>
                  <h3 className="mt-4 font-semibold">
                    {normalizedSearchQuery ? "Dokumen tidak ditemukan" : "Belum ada dokumen"}
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7a7974] dark:text-[#8a8f98]">
                    {normalizedSearchQuery
                      ? "Coba kata kunci lain atau buka daftar dokumen lengkap."
                      : "Mulai wawancara untuk membuat dokumen pertama."}
                  </p>
                </div>
              )}
            </section>

            {draftSessions.length > 0 && (
              <section className="rounded-lg border border-[#ddd7ca] bg-[#fffcf6] dark:border-[#2b2d31] dark:bg-[#111214]">
                <div className="border-b border-[#ddd7ca] px-5 py-4 dark:border-[#2b2d31]">
                  <h2 className="font-semibold">Wawancara belum selesai</h2>
                </div>

                <div className="divide-y divide-[#e4ded2] dark:divide-[#2b2d31]">
                  {draftSessions.map((session) => (
                    <Link
                      key={session.id}
                      href={`/interview?session=${session.id}`}
                      className="flex flex-col gap-2 px-5 py-4 transition hover:bg-[#f7f4ed] dark:hover:bg-[#17181b] md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{session.title || "Wawancara baru"}</p>
                        <p className="mt-1 truncate text-sm text-[#7a7974] dark:text-[#8a8f98]">
                          {session.last_message || "Belum ada ringkasan pesan."}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-[#d6ae1f] dark:text-[#f4d13d]">
                        Lanjutkan
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
