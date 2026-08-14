import type { Metadata } from "next";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import "./globals.css";
import { AppChrome } from "@/components/AppChrome";
import { ConvexClientProvider } from "./ConvexClientProvider";

export const metadata: Metadata = {
  title: "Haywire — Repository to knowledge graph",
  description:
    "Turn any GitHub repository into an interactive knowledge graph. Paste a link, get communities, hub nodes, and EXTRACTED/INFERRED edges.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <body className="font-sans antialiased">
          <ConvexClientProvider>
            <div className="noise" aria-hidden />
            <AppChrome>{children}</AppChrome>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
