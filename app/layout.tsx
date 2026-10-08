import type { Metadata } from "next";
import { Bebas_Neue, Roboto } from "next/font/google";
import { getAppName } from "./app-meta";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: "400",
});

// A function rather than a constant: APP_NAME is read per request, so the title
// tracks whatever the chart injected instead of freezing the CI-time value.
export async function generateMetadata(): Promise<Metadata> {
  const appName = getAppName();

  return {
    title: appName,
    description: `${appName} — a Better Collective better-craft application`,
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${bebasNeue.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
