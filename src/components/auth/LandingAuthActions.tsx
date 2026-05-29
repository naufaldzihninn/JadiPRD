"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  ArrowRight,
  CheckCircle2,
  LayoutDashboard,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClientDb } from "@/lib/firebase/config";
import { useAuth } from "./AuthProvider";
import { UserMenu } from "./UserMenu";

const flowSteps = [
  {
    title: "Mulai wawancara",
    description: "Ceritakan ide, target pengguna, batas MVP, dan preferensi teknis kalau ada.",
    detail: "AI menjaga obrolan tetap terarah: masalah, pengguna, scope, kebutuhan data, dan kriteria sukses.",
  },
  {
    title: "AI susun draft",
    description: "Obrolan diringkas menjadi PRD dan UI Prompt yang siap dibaca.",
    detail: "Output mencakup requirement, flow, diagram, schema, screen, komponen, state, dan guardrail anti-halu.",
  },
  {
    title: "Review per section",
    description: "Kasih note langsung di bagian yang ingin diperbaiki.",
    detail: "Model hanya menerima section yang dipilih, lalu app menyimpan hasilnya sebagai versi baru.",
  },
  {
    title: "Pakai atau bandingkan",
    description: "Salin, unduh, atau buka versi sebelumnya untuk membandingkan perubahan.",
    detail: "Versi lama tetap tersedia, jadi revisi tidak menghapus konteks yang sudah dibuat.",
  },
];

interface LandingOutputDocument {
  created_at?: { seconds?: number };
  id: string;
  updated_at?: { seconds?: number };
}

function useLatestOutputHref() {
  const { isLoading, user } = useAuth();
  const [latestOutputHref, setLatestOutputHref] = useState<string | null>(null);
  const [isCheckingOutput, setIsCheckingOutput] = useState(false);
  const userId = user?.uid || "";

  useEffect(() => {
    if (!userId) {
      return;
    }

    let isMounted = true;

    async function loadLatestOutput() {
      setIsCheckingOutput(true);

      try {
        const db = getClientDb();
        const outputsQuery = query(
          collection(db, "outputs"),
          where("user_id", "==", userId)
        );
        const snapshot = await getDocs(outputsQuery);
        const latest = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<LandingOutputDocument, "id">) }))
          .sort((a, b) => {
            const aTime = a.updated_at?.seconds || a.created_at?.seconds || 0;
            const bTime = b.updated_at?.seconds || b.created_at?.seconds || 0;
            return bTime - aTime;
          })[0];

        if (isMounted) {
          setLatestOutputHref(latest ? `/result/${latest.id}` : null);
        }
      } catch (error) {
        console.error("Gagal mengecek dokumen user", error);

        if (isMounted) {
          setLatestOutputHref(null);
        }
      } finally {
        if (isMounted) {
          setIsCheckingOutput(false);
        }
      }
    }

    loadLatestOutput();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  return {
    hasOutput: Boolean(user && latestOutputHref),
    isBusy: isLoading || Boolean(user && isCheckingOutput),
    latestOutputHref: user ? latestOutputHref : null,
    user,
  };
}

export function LandingNavActions() {
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="h-10 w-24 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] dark:border-[#2b2d31] dark:bg-[#111214]" />
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/dashboard">
          <Button variant="ghost" className="h-10 px-3 text-[#5f5d56] hover:bg-[#ece8de] hover:text-[#26251e] dark:text-[#a9adb5] dark:hover:bg-[#17181b] dark:hover:text-[#f7f8f8]">
            <LayoutDashboard size={16} />
            Dashboard
          </Button>
        </Link>
        <UserMenu />
      </div>
    );
  }

  return (
    <Link href="/login?next=/dashboard">
      <Button className="h-10 bg-[#26251e] px-4 text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]">
        <LogIn size={16} />
        Masuk
      </Button>
    </Link>
  );
}

export function LandingPrimaryActions() {
  const { hasOutput, isBusy, latestOutputHref, user } = useLatestOutputHref();
  const primaryHref = latestOutputHref || (user ? "/interview" : "/login?next=/interview");
  const dashboardHref = user ? "/dashboard" : "/login?next=/dashboard";

  return (
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <Link href={primaryHref} aria-disabled={isBusy}>
        <Button
          disabled={isBusy}
          className="h-11 bg-[#26251e] px-5 text-base text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]"
        >
          {hasOutput ? "Buka PRD" : "Buat PRD"} <ArrowRight size={17} />
        </Button>
      </Link>
      <Link href={dashboardHref} aria-disabled={isBusy}>
        <Button
          disabled={isBusy}
          variant="outline"
          className="h-11 border-[#d8d0c0] bg-[#fffcf6] px-5 text-base text-[#26251e] hover:bg-[#ece8de] dark:border-[#2b2d31] dark:bg-[#111214] dark:text-[#f7f8f8] dark:hover:bg-[#17181b]"
        >
          Buka dashboard
        </Button>
      </Link>
    </div>
  );
}

export function LandingProductPanel() {
  const { hasOutput, latestOutputHref, user } = useLatestOutputHref();
  const primaryHref = latestOutputHref || (user ? "/interview" : "/login?next=/interview");
  const [activePreview, setActivePreview] = useState<"prd" | "ui" | "versions">("prd");
  const preview = {
    prd: {
      eyebrow: "Product Requirements Document",
      title: "Sistem POS Kelontong",
      badge: "PRD.md",
      section: "1. Overview",
      body: "Ringkasan masalah, target pengguna, batas MVP, dan hasil yang diharapkan dalam satu dokumen ringkas.",
      items: ["Core features", "User flow", "Database schema", "Design constraints"],
    },
    ui: {
      eyebrow: "Builder Brief",
      title: "UI Prompt siap tempel",
      badge: "UI Prompt",
      section: "3. Screens",
      body: "Arahan layar, komponen, state, interaksi, dan batasan visual supaya AI builder tidak menebak-nebak.",
      items: ["Routes", "Components", "Loading / empty / error", "Guardrails"],
    },
    versions: {
      eyebrow: "Version History",
      title: "Bandingkan revisi",
      badge: "v1 → v2",
      section: "Revisi section",
      body: "Setiap note menghasilkan versi baru. Bagian yang tidak berubah disalin dari versi sebelumnya, jadi token tetap hemat.",
      items: ["v1 draft awal", "v2 warna direvisi", "v3 copy diperjelas", "Rollback manual"],
    },
  }[activePreview];
  const sidebarItems = [
    { id: "prd" as const, label: "PRD.md" },
    { id: "ui" as const, label: "UI Prompt" },
    { id: "versions" as const, label: "Versi dokumen" },
  ];

  return (
    <section className="mt-8 overflow-hidden rounded-lg border border-[#d9d0bd] bg-[#fffcf6] shadow-[0_24px_80px_rgba(38,37,30,0.08)] dark:border-[#2b2d31] dark:bg-[#111214] dark:shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <div className="h-1.5 bg-[#f4d13d]" />
      <div className="border-b border-[#ddd7ca] px-4 py-3 dark:border-[#2b2d31]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-[#7a7974] dark:text-[#8a8f98]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#eab308]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
            <span className="ml-2 hidden sm:inline">JadiPRD / output preview</span>
          </div>
          <div className="hidden items-center gap-1 rounded-full border border-[#ddd7ca] px-2 py-1 text-xs text-[#5f5d56] dark:border-[#2b2d31] dark:text-[#a9adb5] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#f4d13d]" />
            Contoh preview output
          </div>
        </div>
      </div>

      <div className="grid min-h-[320px] lg:grid-cols-[220px_1fr_260px]">
        <div className="hidden border-r border-[#ddd7ca] bg-[#f7f4ed] p-4 dark:border-[#2b2d31] dark:bg-[#0d0e10] lg:block">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7a7974] dark:text-[#8a8f98]">
            Dokumen
          </p>
          <div className="mt-4 space-y-2">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePreview(item.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                  activePreview === item.id
                    ? "bg-[#26251e] text-[#f7f4ed] dark:bg-[#f4d13d] dark:text-[#08090a]"
                    : "text-[#5f5d56] hover:bg-[#ece8de] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 md:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7a7974] dark:text-[#8a8f98]">
                {preview.eyebrow}
              </p>
              <h2 className="mt-3 text-2xl font-semibold">{preview.title}</h2>
            </div>
            <span className="rounded-full border border-[#ddd7ca] px-2.5 py-1 text-xs text-[#5f5d56] dark:border-[#2b2d31] dark:text-[#a9adb5]">
              {preview.badge}
            </span>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <p className="text-sm font-semibold">{preview.section}</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5f5d56] dark:text-[#a9adb5]">
                {preview.body}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {preview.items.map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-md border border-[#e4ded2] px-3 py-2 text-sm text-[#5f5d56] dark:border-[#2b2d31] dark:text-[#a9adb5]">
                  <CheckCircle2 size={15} className="text-[#d6ae1f] dark:text-[#f4d13d]" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <Link href={primaryHref} className="group mt-6 inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.12em] text-[#d6ae1f] dark:text-[#f4d13d]">
            {hasOutput ? "Buka PRD terakhir" : "Mulai dari wawancara"}
            <span className="transition group-hover:translate-x-1">→</span>
          </Link>
        </div>

        <div className="border-t border-[#ddd7ca] bg-[#fbf8f1] p-5 dark:border-[#2b2d31] dark:bg-[#0d0e10] lg:border-l lg:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7a7974] dark:text-[#8a8f98]">
            Yang kamu dapat
          </p>
          <div className="mt-4 space-y-4">
            {[
              ["PRD.md", "Requirement, alur, skema data, dan batasan MVP."],
              ["UI Prompt", "Instruksi layar, komponen, state, dan guardrail."],
              ["Riwayat versi", "Bandingkan hasil revisi tanpa kehilangan draft lama."],
            ].map(([title, description]) => (
              <div key={title} className="border-b border-[#ddd7ca] pb-4 last:border-0 last:pb-0 dark:border-[#2b2d31]">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full bg-[#f4d13d]" />
                  {title}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#7a7974] dark:text-[#8a8f98]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingFlow() {
  const [activeStep, setActiveStep] = useState(0);
  const active = flowSteps[activeStep];

  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-[#ddd7ca] bg-[#fffcf6] dark:border-[#2b2d31] dark:bg-[#111214]">
      <div className="grid divide-y divide-[#ddd7ca] dark:divide-[#2b2d31] lg:grid-cols-[0.95fr_1.05fr] lg:divide-x lg:divide-y-0">
        <div className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#7a7974] dark:text-[#8a8f98]">
            Flow kerja
          </h2>
          <div className="mt-4 space-y-2">
            {flowSteps.map((step, index) => (
              <button
                key={step.title}
                type="button"
                onClick={() => setActiveStep(index)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                  activeStep === index
                    ? "bg-[#26251e] text-[#f7f4ed] dark:bg-[#f4d13d] dark:text-[#08090a]"
                    : "text-[#5f5d56] hover:bg-[#ece8de] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                    activeStep === index
                      ? "bg-[#f7f4ed] text-[#26251e] dark:bg-[#08090a] dark:text-[#f4d13d]"
                      : "bg-[#f7f4ed] text-[#5f5d56] dark:bg-[#08090a] dark:text-[#a9adb5]"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{step.title}</span>
                  <span className={`mt-0.5 block truncate text-xs ${activeStep === index ? "opacity-75" : "text-[#7a7974] dark:text-[#8a8f98]"}`}>
                    {step.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7a7974] dark:text-[#8a8f98]">
            Tahap {activeStep + 1}
          </p>
          <h3 className="mt-3 text-xl font-semibold">{active.title}</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5f5d56] dark:text-[#a9adb5]">
            {active.description}
          </p>
          <div className="mt-5 rounded-lg border border-[#e4ded2] bg-[#f7f4ed] p-4 dark:border-[#2b2d31] dark:bg-[#08090a]">
            <p className="text-sm leading-6 text-[#5f5d56] dark:text-[#a9adb5]">
              {active.detail}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
