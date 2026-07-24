import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Nexo",
  description: "Sistema de gestión de recursos humanos",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  let defaultTheme: "light" | "dark" = "light";
  if (session) {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { theme: true },
    });
    if (user?.theme === "DARK") defaultTheme = "dark";
  }

  return (
    <html
      lang="es"
      className={`${instrumentSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-main">
        <ThemeProvider defaultTheme={defaultTheme}>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
