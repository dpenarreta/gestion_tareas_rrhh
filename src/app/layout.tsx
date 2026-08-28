import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

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
  // Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): `User.theme` ya
  // se escribe exclusivamente en Django desde el cutover de
  // `PATCH /api/users/[id]/theme` — leer Postgres acá mostraría siempre el
  // tema con el que se importó el usuario, nunca el elegido después.
  const session = await getSession();
  let defaultTheme: "light" | "dark" = "light";
  if (session) {
    const response = await djangoApiFetch("/auth/me/");
    if (response?.ok) {
      const me: { theme?: string } = await response.json();
      if (me.theme === "DARK") defaultTheme = "dark";
    }
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
