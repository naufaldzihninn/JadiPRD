"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandMark } from "@/components/brand/BrandMark";

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function getLoginErrorMessage(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (code === "auth/configuration-not-found") {
    return "Firebase Authentication belum aktif atau Google provider belum di-enable di project ini.";
  }

  if (code === "auth/unauthorized-domain") {
    return "Domain ini belum masuk Authorized domains di Firebase Authentication.";
  }

  if (code === "auth/popup-closed-by-user") {
    return "Popup login ditutup sebelum selesai.";
  }

  if (code === "auth/popup-blocked") {
    return "Popup login diblokir browser. Izinkan popup lalu coba lagi.";
  }

  return "Login Google gagal. Coba lagi sebentar.";
}

function LoginContent() {
  const {
    isLoading,
    isTestAuthEnabled,
    signInForTesting,
    signInWithGoogle,
    user,
  } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningInTest, setIsSigningInTest] = useState(false);
  const [error, setError] = useState("");

  const nextPath = searchParams.get("next") || "/dashboard";

  useEffect(() => {
    if (!isLoading && user) {
      router.replace(nextPath);
    }
  }, [isLoading, nextPath, router, user]);

  const handleLogin = async () => {
    setIsSigningIn(true);
    setError("");

    try {
      await signInWithGoogle();
    } catch (loginError) {
      console.error("Login Google gagal", loginError);
      setError(getLoginErrorMessage(loginError));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleTestLogin = async () => {
    setIsSigningInTest(true);
    setError("");

    try {
      await signInForTesting();
    } catch (loginError) {
      console.error("Login test gagal", loginError);
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Login test gagal. Cek env E2E_TEST_AUTH_ENABLED."
      );
    } finally {
      setIsSigningInTest(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f4ed] px-5 text-[#26251e] dark:bg-[#08090a] dark:text-[#f7f8f8]">
      <div className="w-full max-w-[420px]">
        <Link href="/" className="mx-auto mb-8 flex w-fit items-center gap-3">
          <BrandMark size={42} />
          <div>
            <p className="text-base font-semibold leading-none">
              Jadi<span className="text-[#d6ae1f] dark:text-[#f4d13d]">PRD</span>
            </p>
            <p className="mt-1 text-sm text-[#7a7974] dark:text-[#8a8f98]">
              Dari ide jadi <span className="text-[#d6ae1f] dark:text-[#f4d13d]">PRD</span>
            </p>
          </div>
        </Link>

        <div className="rounded-lg border border-[#ddd7ca] bg-[#fffcf6] p-6 shadow-[0_18px_60px_rgba(38,37,30,0.08)] dark:border-[#2b2d31] dark:bg-[#111214] dark:shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
          <div className="text-center">
            <h1 className="text-2xl font-semibold leading-tight">
              Masuk ke JadiPRD
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#5f5d56] dark:text-[#a9adb5]">
              {isTestAuthEnabled
                ? "Mode testing aktif. Gunakan akun test lokal agar automation bisa masuk tanpa OAuth."
                : "Gunakan akun Google untuk menyimpan PRD, riwayat wawancara, dan hasil revisi."}
            </p>
          </div>

          {isTestAuthEnabled ? (
            <Button
              type="button"
              onClick={handleTestLogin}
              disabled={isSigningInTest}
              data-testid="e2e-test-login"
              className="mt-6 h-11 w-full bg-[#26251e] text-[#f7f4ed] hover:bg-[#3a382f] dark:bg-[#f4d13d] dark:text-[#08090a] dark:hover:bg-[#e4bd27]"
            >
              {isSigningInTest ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Menyiapkan akun test...
                </>
              ) : (
                "Masuk sebagai akun test"
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleLogin}
              disabled={isLoading || isSigningIn || isSigningInTest}
              className="mt-6 h-11 w-full border border-[#d8d0c0] bg-white text-[#26251e] shadow-sm hover:bg-[#f7f4ed] dark:border-[#2b2d31] dark:bg-[#f7f8f8] dark:text-[#08090a] dark:hover:bg-[#eceff1]"
            >
              {isSigningIn ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Menghubungkan...
                </>
              ) : (
                <>
                  <GoogleLogo />
                  Login with Google
                </>
              )}
            </Button>
          )}

          {error && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
              {error}
            </p>
          )}

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-[#ddd7ca] dark:bg-[#2b2d31]" />
            <span className="text-xs text-[#7a7974] dark:text-[#8a8f98]">
              akun baru otomatis dibuat
            </span>
            <span className="h-px flex-1 bg-[#ddd7ca] dark:bg-[#2b2d31]" />
          </div>

          <p className="text-center text-xs leading-5 text-[#7a7974] dark:text-[#8a8f98]">
            Setelah login, kamu akan diarahkan ke halaman yang tadi kamu buka.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f7f4ed] text-[#26251e] dark:bg-[#08090a] dark:text-[#f7f8f8]">
          <Loader2 size={22} className="animate-spin text-[#d6ae1f] dark:text-[#f4d13d]" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
