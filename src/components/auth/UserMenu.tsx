"use client";

import { LogOut, UserCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";

export function UserMenu() {
  const { signOutUser, user } = useAuth();
  const router = useRouter();
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);

    try {
      await signOutUser();
      router.push("/login");
    } finally {
      setIsSigningOut(false);
      setIsConfirmingLogout(false);
    }
  };

  if (!user) {
    return null;
  }

  const logoutDialog =
    isConfirmingLogout && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[100] grid min-h-dvh place-items-center overflow-y-auto bg-black/35 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] dark:border-[#2b2d31] dark:bg-[#111214]">
              <div className="flex items-start gap-3">
                {user.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.photoURL} alt="" className="h-10 w-10 rounded-full" />
                ) : (
                  <UserCircle size={40} className="text-[#7a7974] dark:text-[#8a8f98]" />
                )}
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[#26251e] dark:text-[#f7f8f8]">
                    Keluar dari akun?
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[#5f5d56] dark:text-[#a9adb5]">
                    Kamu akan keluar dari sesi JadiPRD di browser ini. Dokumen yang sudah tersimpan tetap ada di akunmu.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsConfirmingLogout(false)}
                  disabled={isSigningOut}
                  className="h-9 px-3 text-[#5f5d56] hover:bg-[#ece8de] dark:text-[#a9adb5] dark:hover:bg-[#17181b]"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="h-9 bg-[#26251e] px-3 text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]"
                >
                  {isSigningOut ? "Keluar..." : "Ya, logout"}
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#ddd7ca] bg-[#fffcf6] px-2 py-1.5 dark:border-[#2b2d31] dark:bg-[#111214]">
      {user.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.photoURL} alt="" className="h-7 w-7 rounded-full" />
      ) : (
        <UserCircle size={28} className="text-[#7a7974] dark:text-[#8a8f98]" />
      )}
      <div className="hidden min-w-0 sm:block">
        <p className="max-w-36 truncate text-xs font-semibold">
          {user.displayName || "User"}
        </p>
        <p className="max-w-36 truncate text-[11px] text-[#7a7974] dark:text-[#8a8f98]">
          {user.email}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setIsConfirmingLogout(true)}
        className="h-8 w-8 text-[#7a7974] hover:bg-[#ece8de] hover:text-[#26251e] dark:text-[#8a8f98] dark:hover:bg-[#17181b] dark:hover:text-[#f7f8f8]"
        aria-label="Keluar"
      >
        <LogOut size={15} />
      </Button>
      {logoutDialog}
    </div>
  );
}
