"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import OmniRouteLogo from "@/shared/components/OmniRouteLogo";

export default function Navigation() {
  const t = useTranslations("landing");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  return (
    <nav className="fixed top-0 z-50 w-full bg-[var(--color-bg)]/80 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Logo */}
        <button
          type="button"
          className="flex items-center gap-3 cursor-pointer bg-transparent border-none p-0 min-w-0"
          onClick={() => router.push("/")}
          aria-label={t("navigateHome")}
        >
          <div className="size-8 rounded flex items-center justify-center">
            <OmniRouteLogo size={32} />
          </div>
          <h2 className="text-white text-lg sm:text-xl font-bold tracking-tight truncate sm:max-w-none max-w-[160px]">
            {t("brandName")}
          </h2>
        </button>

        {/* Desktop menu */}
        <div className="hidden md:flex items-center gap-8">
          <a
            className="text-gray-300 hover:text-white text-sm font-medium transition-colors"
            href="#features"
          >
            {t("featuresLink")}
          </a>
          <a
            className="text-gray-300 hover:text-white text-sm font-medium transition-colors"
            href="#how-it-works"
          >
            {t("howItWorks")}
          </a>
          <Link
            className="text-gray-300 hover:text-white text-sm font-medium transition-colors"
            href="/docs"
          >
            {t("docsLink")}
          </Link>
          <a
            className="text-gray-300 hover:text-white text-sm font-medium transition-colors flex items-center gap-1"
            href="https://github.com/diegosouzapw/OmniRoute"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("github")}
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
              open_in_new
            </span>
          </a>
        </div>

        {/* CTA + Mobile menu */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <button
            onClick={() => router.push("/dashboard")}
            className="hidden sm:flex h-9 items-center justify-center rounded-lg px-4 bg-primary hover:bg-primary-hover transition-all duration-200 active:scale-[0.98] text-white text-sm font-bold shadow-warm"
          >
            {t("getStarted")}
          </button>
          <button
            className="md:hidden text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={t("toggleMenu")}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {mobileMenuOpen ? "close" : "menu"}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-[var(--color-bg)]/95 backdrop-blur-md">
          <div className="flex flex-col gap-4 p-6">
            <a
              className="text-gray-300 hover:text-white text-sm font-medium transition-colors"
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t("featuresLink")}
            </a>
            <a
              className="text-gray-300 hover:text-white text-sm font-medium transition-colors"
              href="#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t("howItWorks")}
            </a>
            <Link
              className="text-gray-300 hover:text-white text-sm font-medium transition-colors"
              href="/docs"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t("docsLink")}
            </Link>
            <a
              className="text-gray-300 hover:text-white text-sm font-medium transition-colors"
              href="https://github.com/diegosouzapw/OmniRoute"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("github")}
            </a>
            <button
              onClick={() => router.push("/dashboard")}
              className="h-9 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold"
            >
              {t("getStarted")}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
