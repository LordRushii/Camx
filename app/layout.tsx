import { Geist_Mono, Roboto, Montserrat } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AppShell } from "@/components/shell"
import { cn } from "@/lib/utils";
import { ConvexClientProvider } from "./ConvexClientProvider";

const montserratHeading = Montserrat({subsets:['latin'],variable:'--font-heading'});

const roboto = Roboto({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", roboto.variable, montserratHeading.variable)}
    >
      <body>
        <ThemeProvider>
          <ConvexClientProvider>
            <AppShell>{children}</AppShell>
          </ConvexClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
