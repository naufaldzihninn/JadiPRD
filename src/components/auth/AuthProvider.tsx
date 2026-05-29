"use client";

import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getClientAuth } from "@/lib/firebase/config";

interface AuthContextValue {
  getIdToken: () => Promise<string>;
  isLoading: boolean;
  isTestAuthEnabled: boolean;
  signInForTesting: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  user: User | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const isTestAuthEnabled = process.env.NEXT_PUBLIC_E2E_TEST_AUTH_ENABLED === "true";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const auth = getClientAuth();

    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const auth = getClientAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  }, []);

  const signInForTesting = useCallback(async () => {
    const response = await fetch("/api/test-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed: true }),
    });
    const data = (await response.json()) as { error?: string; token?: string };

    if (!response.ok || !data.token) {
      throw new Error(data.error || "Login test tidak tersedia.");
    }

    await signInWithCustomToken(getClientAuth(), data.token);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(getClientAuth());
  }, []);

  const getIdToken = useCallback(async () => {
    const auth = getClientAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error("User belum login.");
    }

    return currentUser.getIdToken();
  }, []);

  const value = useMemo(
    () => ({
      getIdToken,
      isTestAuthEnabled,
      isLoading,
      signInForTesting,
      signInWithGoogle,
      signOutUser,
      user,
    }),
    [getIdToken, isLoading, signInForTesting, signInWithGoogle, signOutUser, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth harus dipakai di dalam AuthProvider.");
  }

  return context;
}
