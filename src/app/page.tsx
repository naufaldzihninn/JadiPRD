import Link from "next/link";
import {
  LandingFlow,
  LandingNavActions,
  LandingPrimaryActions,
  LandingProductPanel,
} from "@/components/auth/LandingAuthActions";
import { BrandMark } from "@/components/brand/BrandMark";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f7f4ed] text-[#26251e] dark:bg-[#08090a] dark:text-[#f7f8f8]">
      <header className="border-b border-[#ddd7ca] bg-[#f7f4ed]/90 backdrop-blur dark:border-[#2b2d31] dark:bg-[#08090a]/88">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark size={38} />
            <span>
              <span className="block text-lg font-semibold leading-none">
                Jadi<span className="text-[#d6ae1f] dark:text-[#f4d13d]">PRD</span>
              </span>
              <span className="mt-1 block text-xs text-[#7a7974] dark:text-[#8a8f98]">
                Dari ide jadi <span className="text-[#d6ae1f] dark:text-[#f4d13d]">PRD</span>
              </span>
            </span>
          </Link>
          <LandingNavActions />
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100svh-73px)] w-full max-w-6xl flex-col justify-start px-5 pb-8 pt-[clamp(2rem,5vh,4.5rem)]">
        <section className="mx-auto max-w-4xl text-center">
          <h1 className="text-balance font-heading text-[42px] font-semibold leading-[1.02] md:text-[clamp(58px,6vw,70px)]">
            Bikin <span className="text-[#d6ae1f] dark:text-[#f4d13d]">PRD</span>
            <span className="block text-[#26251e] dark:text-[#f7f8f8]">
              dari obrolan singkat.
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[16px] leading-7 text-[#5f5d56] dark:text-[#a9adb5]">
            JadiPRD membantu kamu mengubah ide aplikasi menjadi PRD dan UI Prompt yang rapi,
            jelas, dan siap dibawa ke AI builder atau tim engineering.
          </p>
          <LandingPrimaryActions />
        </section>

        <LandingProductPanel />

        <LandingFlow />
      </main>
    </div>
  );
}
