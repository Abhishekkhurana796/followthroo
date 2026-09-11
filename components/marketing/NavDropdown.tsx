"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  safePolygon,
  FloatingPortal,
  type Placement,
} from "@floating-ui/react";
import { ChevronDown, type LucideIcon } from "lucide-react";

export interface MegaMenuItem {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export interface MegaMenuColumn {
  category: string;
  items: MegaMenuItem[];
}

export function NavDropdown({
  label,
  columns,
  placement = "bottom-start",
}: {
  label: string;
  columns: MegaMenuColumn[];
  placement?: Placement;
}) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [offset(14), flip({ padding: 16 }), shift({ padding: 16 })],
  });

  const hover = useHover(context, { handleClose: safePolygon(), delay: { open: 50, close: 150 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  return (
    <div className="relative inline-block">
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        className={`flex items-center gap-1 text-sm font-medium transition-colors ${
          open ? "text-accent" : "text-ink-soft hover:text-ink"
        }`}
      >
        <span>{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180 text-accent" : ""}`} />
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-screen max-w-4xl p-2 animate-in fade-in-0 zoom-in-95 duration-150"
          >
            <div className="overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {columns.map((col) => (
                  <div key={col.category} className="space-y-3">
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-soft/70 px-2">
                      {col.category}
                    </div>
                    <div className="space-y-1">
                      {col.items.map((item) => (
                        <Link
                          key={item.title}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="group flex items-start gap-3 rounded-2xl p-2.5 transition-all hover:bg-accent/5"
                        >
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent transition-transform group-hover:scale-105 group-hover:bg-accent group-hover:text-white">
                            <item.icon className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 font-display text-sm font-bold text-ink group-hover:text-accent">
                              <span>{item.title}</span>
                              {item.badge && (
                                <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-accent">
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-ink-soft leading-snug line-clamp-2">{item.description}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

export default NavDropdown;
