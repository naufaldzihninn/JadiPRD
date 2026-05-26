"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const storageKey = "jadiprd-theme";
const changeEvent = "jadiprd-theme-change";

function readThemePreference() {
  const savedTheme = window.localStorage.getItem(storageKey);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  return savedTheme ? savedTheme === "dark" : prefersDark;
}

function subscribeThemeChange(callback: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const notify = () => callback();

  window.addEventListener(changeEvent, notify);
  window.addEventListener("storage", notify);
  mediaQuery.addEventListener("change", notify);

  return () => {
    window.removeEventListener(changeEvent, notify);
    window.removeEventListener("storage", notify);
    mediaQuery.removeEventListener("change", notify);
  };
}

function getThemeSnapshot() {
  return readThemePreference();
}

function getServerThemeSnapshot() {
  return false;
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(
    subscribeThemeChange,
    getThemeSnapshot,
    getServerThemeSnapshot
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    document.documentElement.classList.toggle("dark", nextTheme);
    window.localStorage.setItem(storageKey, nextTheme ? "dark" : "light");
    window.dispatchEvent(new Event(changeEvent));
  };

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      aria-pressed={isDark}
      onClick={toggleTheme}
      className="fixed bottom-5 left-5 z-50 flex h-10 w-[74px] items-center rounded-full border border-[#ddd7ca] bg-[#fffcf6] p-1 shadow-[0_18px_45px_rgba(38,37,30,0.14)] transition-colors dark:border-[#2b2d31] dark:bg-[#111214]"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full bg-[#26251e] text-[#f7f4ed] shadow-sm transition-transform dark:bg-[#f4d13d] dark:text-[#08090a] ${
          isDark ? "translate-x-[34px]" : "translate-x-0"
        }`}
      >
        {isDark ? <Moon size={15} /> : <Sun size={15} />}
      </span>
    </button>
  );
}
