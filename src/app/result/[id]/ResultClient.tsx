"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  ArrowLeft,
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "next/navigation";
import { ensureMarkdownContent } from "@/lib/markdown/normalize";

type MentionTarget = "prd" | "ui" | "both";
type MarkdownNodeWithPosition = {
  position?: {
    start?: {
      line?: number;
    };
  };
};
type TocHeading = {
  id: string;
  level: number;
  line: number;
  title: string;
};
type OutputVersion = {
  id: string;
  prd_content: string;
  ui_prompt_content: string;
  version: number;
};

function getHeadingKey(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function cleanHeadingText(text: string) {
  return text
    .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, "$1")
    .replace(/\\/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyHeading(text: string) {
  return cleanHeadingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function extractHeadings(content: string): TocHeading[] {
  return content
    .split("\n")
    .map((line, index) => {
      const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);

      if (!match) {
        return null;
      }

      const title = cleanHeadingText(match[2]);

      return {
        id: `section-${index + 1}-${slugifyHeading(title) || "heading"}`,
        level: match[1].length,
        line: index + 1,
        title,
      };
    })
    .filter((heading): heading is TocHeading => Boolean(heading));
}

interface ResultClientProps {
  id: string;
  initialPrdContent: string;
  initialUiPromptContent: string;
}

function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const diagramId = `mermaid-${useId().replace(/:/g, "")}`;
  const normalizedChart = useMemo(() => normalizeMermaidChart(chart), [chart]);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: "#fffcf6",
            primaryColor: "#f7f4ed",
            primaryTextColor: "#26251e",
            primaryBorderColor: "#d8d0c0",
            lineColor: "#7a7974",
            secondaryColor: "#fff7d6",
            tertiaryColor: "#ffffff",
            fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui",
          },
        });

        const result = await mermaid.render(diagramId, normalizedChart);

        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : "Gagal render diagram.");
          setSvg("");
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [diagramId, normalizedChart]);

  if (error) {
    return (
      <div className="not-prose my-6 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] dark:border-[#2b2d31] dark:bg-[#111214]">
        <div className="border-b border-[#ddd7ca] px-4 py-2 text-xs font-medium text-[#7a7974] dark:border-[#2b2d31] dark:text-[#8a8f98]">
          Diagram belum bisa dipreview, markdown asli tetap tersedia.
        </div>
        <pre className="overflow-x-auto p-4 text-sm text-[#26251e] dark:text-[#f7f8f8]">
          <code>{chart}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="rounded-lg border border-[#ddd7ca] bg-[#f7f4ed] p-4 text-sm text-[#7a7974] dark:border-[#2b2d31] dark:bg-[#08090a] dark:text-[#8a8f98]">
        Merender diagram...
      </div>
    );
  }

  return (
    <div className="not-prose my-6 overflow-x-auto rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-4 dark:border-[#2b2d31]">
      <div className="min-w-[720px]" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function normalizeMermaidChart(chart: string) {
  const trimmed = chart.trim();

  if (!/^erDiagram\b/.test(trimmed)) {
    return chart;
  }

  const lines = trimmed.split("\n");
  const output: string[] = ["erDiagram"];
  let currentEntity = "";
  let hasUnsupportedField = false;

  const normalizeEntity = (name: string) =>
    name
      .trim()
      .replace(/[^\p{L}\p{N}_]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
  const normalizeField = (name: string) =>
    name
      .trim()
      .replace(/["'(),]/g, "")
      .replace(/[^\p{L}\p{N}_]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
  const normalizeType = (type: string) => {
    const normalized = type.toLowerCase();

    if (/uuid|varchar|text|string|email|enum/.test(normalized)) return "string";
    if (/int|number/.test(normalized)) return "int";
    if (/decimal|float|double|price|amount/.test(normalized)) return "float";
    if (/bool/.test(normalized)) return "boolean";
    if (/time|date/.test(normalized)) return "datetime";

    return "string";
  };

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (/^[\p{L}\p{N}_ -]+\{$/u.test(line)) {
      currentEntity = normalizeEntity(line.replace(/\{$/, ""));
      output.push(`  ${currentEntity} {`);
      continue;
    }

    if (line === "}") {
      if (currentEntity) {
        output.push("  }");
      }
      currentEntity = "";
      continue;
    }

    if (currentEntity) {
      const [type = "string", ...fieldParts] = line.split(/\s+/);
      const fieldName = normalizeField(
        fieldParts.filter((part) => !/^(PK|FK|UNIQUE)$/i.test(part)).join("_")
      );

      if (fieldName) {
        hasUnsupportedField ||= /(PK|FK|UNIQUE|VARCHAR|UUID|DECIMAL|BOOLEAN|TIMESTAMP|ENUM)/i.test(line);
        output.push(`    ${normalizeType(type)} ${fieldName}`);
      }

      continue;
    }

    if (/[|}{][|o{]/.test(line) && /:/.test(line)) {
      output.push(
        line.replace(/^[\p{L}\p{N}_ -]+|[\p{L}\p{N}_ -]+(?=\s*:)/gu, (name) =>
          normalizeEntity(name)
        )
      );
    }
  }

  return hasUnsupportedField ? output.join("\n") : chart;
}

function getTextFromChildren(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map(getTextFromChildren).join("");
  }

  if (children && typeof children === "object" && "props" in children) {
    const props = children.props as { children?: React.ReactNode };
    return getTextFromChildren(props.children);
  }

  return "";
}

function SectionHeading({
  children,
  headingId,
  level,
  onOpenNote,
  occurrence,
  startLine,
}: {
  children: React.ReactNode;
  headingId?: string;
  level: 2 | 3;
  occurrence: number;
  onOpenNote: (section: string, occurrence: number, startLine?: number) => void;
  startLine?: number;
}) {
  const sectionTitle = getTextFromChildren(children).trim();
  const HeadingTag = level === 2 ? "h2" : "h3";

  return (
    <div className="not-prose my-6">
      <div className="flex items-start justify-between gap-3">
        <HeadingTag id={headingId} className={`${level === 2 ? "text-2xl" : "text-xl"} m-0 scroll-mt-24 font-semibold leading-tight`}>
          {children}
        </HeadingTag>
        <button
          type="button"
          onClick={() => onOpenNote(sectionTitle, occurrence, startLine)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#d8d0c0] bg-[#fffcf6] px-2.5 text-xs font-medium text-[#5f5d56] hover:bg-[#ece8de] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
        >
          <MessageSquarePlus size={14} />
          Beri note
        </button>
      </div>
    </div>
  );
}

function MarkdownPreview({
  content,
  headingIdsByLine = {},
  onOpenNote = () => {},
}: {
  content: string;
  headingIdsByLine?: Record<number, string>;
  onOpenNote?: (section: string, occurrence: number, startLine?: number) => void;
}) {
  const headingOccurrences = new Map<string, number>();
  const getHeadingOccurrence = (children: React.ReactNode) => {
    const title = getTextFromChildren(children);
    const key = getHeadingKey(title);
    const occurrence = (headingOccurrences.get(key) ?? 0) + 1;
    headingOccurrences.set(key, occurrence);

    return occurrence;
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2({ children, node }) {
          const startLine = (node as MarkdownNodeWithPosition | undefined)?.position?.start?.line;

          return (
            <SectionHeading
              headingId={startLine ? headingIdsByLine[startLine] : undefined}
              level={2}
              onOpenNote={onOpenNote}
              occurrence={getHeadingOccurrence(children)}
              startLine={startLine}
            >
              {children}
            </SectionHeading>
          );
        },
        h3({ children, node }) {
          const startLine = (node as MarkdownNodeWithPosition | undefined)?.position?.start?.line;

          return (
            <SectionHeading
              headingId={startLine ? headingIdsByLine[startLine] : undefined}
              level={3}
              onOpenNote={onOpenNote}
              occurrence={getHeadingOccurrence(children)}
              startLine={startLine}
            >
              {children}
            </SectionHeading>
          );
        },
        h1({ children, node }) {
          const startLine = (node as MarkdownNodeWithPosition | undefined)?.position?.start?.line;
          const headingId = startLine ? headingIdsByLine[startLine] : undefined;

          return (
            <h1 id={headingId} className="scroll-mt-24">
              {children}
            </h1>
          );
        },
        code({ className, children, ...props }) {
          const language = /language-(\w+)/.exec(className || "")?.[1];

          if (language === "mermaid") {
            return <MermaidBlock chart={String(children).replace(/\n$/, "")} />;
          }

          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function ResultClient({
  id,
  initialPrdContent,
  initialUiPromptContent,
}: ResultClientProps) {
  const router = useRouter();
  const { getIdToken, isLoading: isAuthLoading, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"prd" | "ui">("prd");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [activeNoteSection, setActiveNoteSection] = useState("");
  const [activeNoteOccurrence, setActiveNoteOccurrence] = useState(1);
  const [activeNoteStartLine, setActiveNoteStartLine] = useState<number | undefined>();
  const [activeVersionId, setActiveVersionId] = useState("current");
  const [sectionNote, setSectionNote] = useState("");
  const [versions, setVersions] = useState<OutputVersion[]>([]);

  const [prdContent, setPrdContent] = useState(() =>
    ensureMarkdownContent(initialPrdContent, {
      fallback: "Data PRD tidak ditemukan.",
      title: "PRD",
    })
  );
  const [uiContent, setUiContent] = useState(() =>
    ensureMarkdownContent(initialUiPromptContent, {
      fallback: "Data UI Prompt tidak ditemukan.",
      title: "UI Prompt",
    })
  );

  const activeContent = ensureMarkdownContent(
    activeTab === "prd" ? prdContent : uiContent,
    {
      fallback: activeTab === "prd" ? "Data PRD kosong." : "Data UI Prompt kosong.",
      title: activeTab === "prd" ? "PRD" : "UI Prompt",
    }
  );

  const wordCount = activeContent.trim().split(/\s+/).filter(Boolean).length;
  const lineCount = activeContent.split("\n").length;
  const tocHeadings = useMemo(() => extractHeadings(activeContent), [activeContent]);
  const headingIdsByLine = useMemo(
    () =>
      tocHeadings.reduce<Record<number, string>>((acc, heading) => {
        acc[heading.line] = heading.id;
        return acc;
      }, {}),
    [tocHeadings]
  );

  useEffect(() => {
    if (isAuthLoading || !user) {
      return;
    }

    let cancelled = false;

    async function loadVersions() {
      try {
        const token = await getIdToken();
        const response = await fetch(`/api/outputs/${id}/versions`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (!cancelled && Array.isArray(data.versions)) {
          setVersions(data.versions);
          const latest = data.versions.at(-1);

          if (latest?.id) {
            setActiveVersionId(latest.id);
          }
        }
      } catch (error) {
        console.error("Gagal memuat versi dokumen", error);
      }
    }

    loadVersions();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, id, isAuthLoading, user]);

  const handleSelectVersion = (version: OutputVersion) => {
    setPrdContent(
      ensureMarkdownContent(version.prd_content, {
        fallback: prdContent,
        title: "PRD",
      })
    );
    setUiContent(
      ensureMarkdownContent(version.ui_prompt_content, {
        fallback: uiContent,
        title: "UI Prompt",
      })
    );
    setActiveVersionId(version.id);
    setActiveNoteSection("");
    setSectionNote("");
    setRevisionFeedback(`Sedang melihat v${version.version}. Revisi berikutnya akan dibuat sebagai versi baru.`);
  };

  const scrollToHeading = (headingId: string) => {
    document.getElementById(headingId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (activeTab === "prd") {
      setPrdContent(e.target.value);
    } else {
      setUiContent(e.target.value);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setRevisionFeedback("");

    try {
      const token = await getIdToken();
      const response = await fetch(`/api/outputs/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prd_content: prdContent,
          ui_prompt_content: uiContent,
        }),
      });

      if (!response.ok) {
        throw new Error("Gagal menyimpan perubahan");
      }

      const data = await response.json();

      if (data.version) {
        setVersions((currentVersions) => [
          ...currentVersions,
          {
            id: data.version_id || `v${data.version}`,
            prd_content: prdContent,
            ui_prompt_content: uiContent,
            version: data.version,
          },
        ]);
        setActiveVersionId(data.version_id || `v${data.version}`);
      }

      setIsEditing(false);
      setRevisionFeedback("Perubahan berhasil disimpan.");
      router.refresh();
    } catch (error) {
      console.error("Gagal menyimpan perubahan", error);
      alert("Gagal menyimpan perubahan. Coba lagi sebentar.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activeContent);
  };

  const handleDownload = () => {
    const blob = new Blob([activeContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
      a.download = activeTab === "prd" ? "PRD.md" : "PROMPT_UI.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const applyRevision = async ({
    instruction,
    mode = "document",
    sectionOccurrence,
    sectionStartLine,
    sectionTitle,
    target,
  }: {
    instruction: string;
    mode?: "document" | "section";
    sectionOccurrence?: number;
    sectionStartLine?: number;
    sectionTitle?: string;
    target: MentionTarget;
  }) => {
    if (!instruction.trim() || isRevising) {
      return;
    }

    setIsRevising(true);
    setRevisionFeedback("");

    try {
      const token = await getIdToken();
      const response = await fetch("/api/revise", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
          target,
          mode,
          sectionOccurrence,
          sectionStartLine,
          sectionTitle,
          instruction: instruction.trim(),
          prdContent,
          uiContent,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Revisi gagal diproses");
      }

      if (typeof data.prd_content === "string") {
        setPrdContent(data.prd_content);
      }

      if (typeof data.ui_prompt_content === "string") {
        setUiContent(data.ui_prompt_content);
      }

      if (data.version) {
        const nextVersion: OutputVersion = {
          id: data.version_id || `v${data.version}`,
          prd_content: typeof data.prd_content === "string" ? data.prd_content : prdContent,
          ui_prompt_content:
            typeof data.ui_prompt_content === "string" ? data.ui_prompt_content : uiContent,
          version: data.version,
        };
        setVersions((currentVersions) => [...currentVersions, nextVersion]);
        setActiveVersionId(nextVersion.id);
      }

      if (target === "ui") {
        setActiveTab("ui");
      } else if (target === "prd") {
        setActiveTab("prd");
      }

      setSectionNote("");
      setActiveNoteSection("");
      setActiveNoteOccurrence(1);
      setActiveNoteStartLine(undefined);
      setRevisionFeedback(`Revisi berhasil diterapkan lewat ${String(data.provider).toUpperCase()}.`);
      router.refresh();
    } catch (error) {
      console.error("Gagal merevisi", error);
      setRevisionFeedback(
        error instanceof Error
          ? error.message
          : "Revisi gagal diproses. Coba lagi dengan instruksi lebih spesifik."
      );
    } finally {
      setIsRevising(false);
    }
  };

  const handleSectionRevise = async (sectionTitle: string) => {
    const target: MentionTarget = activeTab === "prd" ? "prd" : "ui";

    await applyRevision({
      target,
      mode: "section",
      sectionOccurrence: activeNoteOccurrence,
      sectionStartLine: activeNoteStartLine,
      sectionTitle,
      instruction: sectionNote.trim(),
    });
  };

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col overflow-hidden bg-[#f7f4ed] text-[#26251e] dark:bg-[#08090a] dark:text-[#f7f8f8]">
      <header className="flex shrink-0 items-center justify-between border-b border-[#ddd7ca] bg-[#f7f4ed]/92 px-5 py-4 backdrop-blur dark:border-[#2b2d31] dark:bg-[#08090a]/90 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="text-[#7a7974] hover:bg-[#ece8de] hover:text-[#26251e] dark:text-[#8a8f98] dark:hover:bg-[#17181b] dark:hover:text-[#f7f8f8]">
              <ArrowLeft size={20} />
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
                {activeTab === "prd" ? (
                  <>
                    <FileText size={18} className="shrink-0 text-[#d6ae1f] dark:text-[#f4d13d]" />
                    <span className="truncate">PRD.md</span>
                  </>
                ) : (
                  <>
                    <Code2 size={18} className="shrink-0 text-[#d6ae1f] dark:text-[#f4d13d]" />
                    <span className="truncate">PROMPT_UI.md</span>
                  </>
                )}
              </h1>

              {versions.length > 0 && (
                <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-[#d8d0c0] bg-[#fffcf6] p-1 dark:border-[#2b2d31] dark:bg-[#111214]">
                  {versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      title={`Lihat versi ${version.version}`}
                      onClick={() => handleSelectVersion(version)}
                      className={`h-7 shrink-0 rounded-md px-2 text-xs font-medium transition ${
                        activeVersionId === version.id
                          ? "bg-[#26251e] text-[#f7f4ed] dark:bg-[#f4d13d] dark:text-[#08090a]"
                          : "text-[#5f5d56] hover:bg-[#ece8de] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
                      }`}
                    >
                      v{version.version}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="truncate text-xs text-[#7a7974] dark:text-[#8a8f98]">{isEditing ? "Markdown editor" : "Preview dokumen"}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <UserMenu />
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setIsEditing(false)}
                className="h-10 text-[#7a7974] hover:bg-[#ece8de] hover:text-[#26251e] dark:text-[#8a8f98] dark:hover:bg-[#17181b] dark:hover:text-[#f7f8f8]"
                disabled={isSaving}
              >
                <X size={16} /> Batal
              </Button>
              <Button onClick={handleSave} className="h-10 bg-[#26251e] px-4 text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Menyimpan
                  </>
                ) : (
                  <>
                    <Check size={16} /> Simpan
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleCopy}
                className="hidden h-10 border-[#d8d0c0] bg-[#fffcf6] px-3 text-[#26251e] hover:bg-[#ece8de] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#f7f8f8] dark:hover:bg-[#17181b] sm:inline-flex"
              >
                <Copy size={16} /> Salin
              </Button>
              <Button
                onClick={handleDownload}
                className="hidden h-10 bg-[#26251e] px-4 text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27] sm:inline-flex"
              >
                <Download size={16} /> Unduh
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-[#ddd7ca] bg-[#f0ece3] p-4 dark:border-[#2b2d31] dark:bg-[#0f1011] lg:block">
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setActiveTab("prd")}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm ${
                activeTab === "prd"
                  ? "bg-[#26251e] text-[#f7f4ed] dark:bg-[#f4d13d] dark:text-[#08090a]"
                  : "text-[#5f5d56] hover:bg-[#e8e1d5] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
              }`}
            >
              <span className="flex items-center gap-2 font-medium"><FileText size={16} /> PRD</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ui")}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm ${
                activeTab === "ui"
                  ? "bg-[#26251e] text-[#f7f4ed] dark:bg-[#f4d13d] dark:text-[#08090a]"
                  : "text-[#5f5d56] hover:bg-[#e8e1d5] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
              }`}
            >
              <span className="flex items-center gap-2 font-medium"><Code2 size={16} /> UI Prompt</span>
            </button>
          </div>

          <div className="mt-5 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-4 dark:border-[#2b2d31] dark:bg-[#111214]">
            <p className="text-xs font-semibold uppercase text-[#7a7974] dark:text-[#8a8f98]">Statistik dokumen</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xl font-semibold">{wordCount}</p>
                <p className="text-xs text-[#7a7974] dark:text-[#8a8f98]">kata</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">{lineCount}</p>
                <p className="text-xs text-[#7a7974] dark:text-[#8a8f98]">baris</p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-4 dark:border-[#2b2d31] dark:bg-[#111214]">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={16} className="text-[#d6ae1f] dark:text-[#f4d13d]" />
              Asisten revisi
            </div>
            <p className="mt-2 text-xs leading-5 text-[#7a7974] dark:text-[#8a8f98]">
              Klik tombol Beri note di section PRD atau UI Prompt yang ingin direview.
            </p>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 gap-1 border-b border-[#ddd7ca] bg-[#fffcf6] px-4 dark:border-[#2b2d31] dark:bg-[#111214] lg:hidden">
            <button
              onClick={() => setActiveTab("prd")}
              className={`flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${
                activeTab === "prd"
                  ? "border-[#d6ae1f] text-[#d6ae1f] dark:border-[#f4d13d] dark:text-[#f4d13d]"
                  : "border-transparent text-[#7a7974] dark:text-[#8a8f98]"
              }`}
            >
              <FileText size={16} /> PRD
            </button>
            <button
              onClick={() => setActiveTab("ui")}
              className={`flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${
                activeTab === "ui"
                  ? "border-[#d6ae1f] text-[#d6ae1f] dark:border-[#f4d13d] dark:text-[#f4d13d]"
                  : "border-transparent text-[#7a7974] dark:text-[#8a8f98]"
              }`}
            >
              <Code2 size={16} /> UI Prompt
            </button>
          </div>

          <section className={`min-h-0 flex-1 overflow-hidden ${isEditing ? "" : "overflow-y-auto px-4 py-6 md:px-6"}`}>
            {isEditing ? (
              <div className="grid h-full md:grid-cols-2">
                <div className="flex min-h-0 flex-col border-r border-[#ddd7ca] bg-[#fffcf6] dark:border-[#2b2d31] dark:bg-[#08090a]">
                  <div className="flex shrink-0 items-center border-b border-[#ddd7ca] bg-[#fcfaf5] px-4 py-2 font-mono text-xs text-[#7a7974] dark:border-[#2b2d31] dark:bg-[#0f1011] dark:text-[#8a8f98]">
                    Editor
                  </div>
                  <textarea
                    value={activeContent}
                    onChange={handleContentChange}
                    className="w-full flex-1 resize-none bg-transparent p-6 font-mono text-sm leading-relaxed text-[#26251e] outline-none dark:text-[#f7f8f8]"
                    spellCheck={false}
                  />
                </div>
                <div className="hidden min-h-0 flex-col overflow-hidden bg-[#f0ece3] dark:bg-[#0f1011] md:flex">
                  <div className="flex shrink-0 items-center border-b border-[#ddd7ca] bg-[#e8e1d5] px-4 py-2 font-mono text-xs text-[#5f5d56] dark:border-[#2b2d31] dark:bg-[#17181b] dark:text-[#a9adb5]">
                    Preview
                  </div>
                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="prose prose-stone max-w-none rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-8 dark:prose-invert dark:border-[#2b2d31] dark:bg-[#111214]">
                      <MarkdownPreview content={activeContent} headingIdsByLine={headingIdsByLine} />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-5xl pb-12">
                {revisionFeedback && (
                  <div className="mb-4 rounded-lg border border-[#d8d0c0] bg-[#fffcf6] px-4 py-3 text-sm text-[#5f5d56] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#a9adb5]">
                    {revisionFeedback}
                  </div>
                )}
                {activeNoteSection && (
                  <div className="sticky top-0 z-10 mb-4 rounded-lg border border-[#d8d0c0] bg-[#fcfaf5] p-3 shadow-[0_14px_38px_rgba(38,37,30,0.12)] dark:border-[#2b2d31] dark:bg-[#0b0c0d] dark:shadow-[0_14px_38px_rgba(0,0,0,0.35)]">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-[#7a7974] dark:text-[#8a8f98]">
                          Note untuk section
                        </p>
                        <p className="mt-1 text-sm font-semibold">{activeNoteSection}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setActiveNoteSection("");
                          setActiveNoteOccurrence(1);
                          setActiveNoteStartLine(undefined);
                          setSectionNote("");
                        }}
                        className="h-8 px-2 text-[#7a7974] hover:bg-[#ece8de] hover:text-[#26251e] dark:text-[#8a8f98] dark:hover:bg-[#17181b] dark:hover:text-[#f7f8f8]"
                        disabled={isRevising}
                      >
                        <X size={15} />
                      </Button>
                    </div>
                    <textarea
                      value={sectionNote}
                      onChange={(event) => setSectionNote(event.target.value)}
                      placeholder={`Tulis catatan untuk section "${activeNoteSection}"...`}
                      className="min-h-24 w-full resize-y rounded-lg border border-[#d8d0c0] bg-[#fffcf6] p-3 text-sm text-[#26251e] outline-none focus:ring-2 focus:ring-[#d6ae1f] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#f7f8f8] dark:focus:ring-[#f4d13d]"
                      disabled={isRevising}
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setActiveNoteSection("");
                          setActiveNoteOccurrence(1);
                          setActiveNoteStartLine(undefined);
                          setSectionNote("");
                        }}
                        className="h-9 text-[#7a7974] hover:bg-[#ece8de] hover:text-[#26251e] dark:text-[#8a8f98] dark:hover:bg-[#17181b] dark:hover:text-[#f7f8f8]"
                        disabled={isRevising}
                      >
                        Batal
                      </Button>
                      <Button
                        type="button"
                        onClick={() => handleSectionRevise(activeNoteSection)}
                        disabled={!sectionNote.trim() || isRevising}
                        className="h-9 bg-[#26251e] px-3 text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]"
                      >
                        {isRevising ? (
                          <>
                            <Loader2 size={15} className="animate-spin" /> Merevisi
                          </>
                        ) : (
                          <>
                            <Wand2 size={15} /> Review section
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="prose prose-stone max-w-none rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-6 shadow-[0_24px_80px_rgba(38,37,30,0.08)] dark:prose-invert dark:border-[#2b2d31] dark:bg-[#111214] dark:shadow-[0_24px_80px_rgba(0,0,0,0.34)] md:p-9">
                  <MarkdownPreview
                    content={activeContent}
                    headingIdsByLine={headingIdsByLine}
                    onOpenNote={(section, occurrence, startLine) => {
                      setActiveNoteSection(section);
                      setActiveNoteOccurrence(occurrence);
                      setActiveNoteStartLine(startLine);
                      setSectionNote("");
                      setRevisionFeedback("");
                    }}
                  />
                </div>
              </div>
            )}
          </section>
        </main>
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-[#ddd7ca] bg-[#f0ece3] p-4 dark:border-[#2b2d31] dark:bg-[#0f1011] xl:block">
          <div className="rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-4 dark:border-[#2b2d31] dark:bg-[#111214]">
            <p className="text-xs font-semibold uppercase text-[#7a7974] dark:text-[#8a8f98]">
              Daftar isi
            </p>
            <div className="mt-3 space-y-1">
              {tocHeadings.length > 0 ? (
                tocHeadings.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    onClick={() => scrollToHeading(heading.id)}
                    className={`block w-full rounded-md px-2 py-1.5 text-left text-xs leading-5 text-[#5f5d56] hover:bg-[#ece8de] hover:text-[#26251e] dark:text-[#a9adb5] dark:hover:bg-[#17181b] dark:hover:text-[#f7f8f8] ${
                      heading.level === 1
                        ? "font-semibold"
                        : heading.level === 2
                          ? "pl-4"
                          : "pl-7"
                    }`}
                  >
                    {heading.title}
                  </button>
                ))
              ) : (
                <p className="text-xs leading-5 text-[#7a7974] dark:text-[#8a8f98]">
                  Heading belum terbaca.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
    </ProtectedRoute>
  );
}
