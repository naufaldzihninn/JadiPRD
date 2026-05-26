"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, pathname, router, user]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f4ed] text-[#26251e] dark:bg-[#08090a] dark:text-[#f7f8f8]">
        <div className="flex items-center gap-3 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] px-4 py-3 text-sm dark:border-[#2b2d31] dark:bg-[#111214]">
          <Loader2 size={17} className="animate-spin text-[#d6ae1f] dark:text-[#f4d13d]" />
          Menyiapkan dashboard...
        </div>
      </div>
    );
  }

  return children;
}
