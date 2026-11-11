import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Proveedor } from "@/components/Proveedor";

export const metadata: Metadata = {
  title: "Familianzas",
  description: "Negocio y familia, cada peso en su lugar.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icono.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Familianzas", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f5e75",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" data-ambito="familia" suppressHydrationWarning>
      <body className="min-h-dvh">
        <Proveedor>{children}</Proveedor>
      </body>
    </html>
  );
}
