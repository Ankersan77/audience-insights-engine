import type { Metadata } from "next";
import { getAppName } from "./app-meta";
import "./globals.css";

// A function rather than a constant: the application name is read per request,
// so the title tracks the runtime environment instead of the build environment.
export async function generateMetadata(): Promise<Metadata> {
  const appName = getAppName();

  return {
    title: appName,
    description: `${appName} — evidence-backed market intelligence`,
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
