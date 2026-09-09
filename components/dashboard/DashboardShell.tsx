"use client";

import React, { Suspense } from "react";
import Sidebar from "@/components/dashboard/Sidebar";
import { SWRProvider } from "@/components/dashboard/SWRProvider";
import { TourProvider } from "@/components/dashboard/tour/TourProvider";
import { TourOverlay } from "@/components/dashboard/tour/TourOverlay";
import { ToastProvider, DialogsProvider } from "@/components/ui";
import type { OnboardingState } from "@/lib/queries";

/**
 * The dashboard's single client boundary.
 *
 * `app/dashboard/layout.tsx` stays a server component and passes its
 * already-rendered `children` through as a prop, so pages keep server-rendering
 * while everything here runs on the client.
 *
 * This layout is NOT re-executed when the router moves between dashboard
 * routes — only the page segment swaps — so state held by these providers
 * survives navigation. That is the whole reason a tour step on
 * /dashboard/campaigns can continue one that started on /dashboard, with no
 * store, no URL state and no sessionStorage.
 */
export function DashboardShell({
  children,
  onboarding,
}: {
  children: React.ReactNode;
  onboarding: OnboardingState | null;
}) {
  return (
      <SWRProvider>
        <ToastProvider>
          <DialogsProvider>
            {/* TourProvider reads useSearchParams for the ?tour= deep link,
                which Next requires to sit under a Suspense boundary. */}
            <Suspense fallback={null}>
              <TourProvider initial={onboarding}>
                <div className="flex min-h-screen bg-canvas text-ink">
                  <a
                    href="#dash-main"
                    className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-invert"
                  >
                    Skip to content
                  </a>
                  <Sidebar />
                  {/* pt-14 clears the fixed mobile topbar; the rail replaces it at lg. */}
                  <main id="dash-main" className="min-w-0 flex-1 pt-14 lg:pt-0">
                    {children}
                  </main>
                </div>
                <TourOverlay />
              </TourProvider>
            </Suspense>
          </DialogsProvider>
        </ToastProvider>
      </SWRProvider>
  );
}
