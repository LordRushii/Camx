"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { type ReactNode } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { readonly children: ReactNode }) {
  return (
    <ConvexProvider client={convex}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </ConvexProvider>
  );
}
