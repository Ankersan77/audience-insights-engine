import { getAppName, getAppVersion } from "./app-meta";

// APP_NAME arrives from the container environment, so this page has to render
// per request. Without this Next prerenders it during `next build` and bakes in
// whatever value existed in CI — which is none.
export const dynamic = "force-dynamic";

const FACTS = [
  ["Runtime", "Next.js"],
  ["Port", "3000"],
  ["Health", "/healthz"],
] as const;

export default function Home() {
  const appName = getAppName();
  const version = getAppVersion();

  return (
    <>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-20">
        <p className="font-display text-sm tracking-[0.35em] text-accent uppercase">D4WN</p>

        <div className="flex flex-col gap-5">
          <h1 className="font-display text-6xl leading-none tracking-wide break-words uppercase sm:text-8xl">
            {appName}
          </h1>
          <div className="h-1 w-24 bg-accent" />
        </div>

        <p className="max-w-xl text-lg leading-relaxed text-muted">
          Evidence-backed market intelligence, behavioral trends, brand
          positioning, and campaign learning in one place.
        </p>

        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          {FACTS.map(([label, value]) => (
            <div key={label} className="bg-surface px-5 py-4">
              <dt className="text-xs tracking-widest text-muted uppercase">
                {label}
              </dt>
              <dd className="mt-1 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </main>

      {/* Rendered only when the runtime supplies a version, so `pnpm dev` does
          not show an empty or misleading one. */}
      {version && (
        <footer className="mx-auto w-full max-w-3xl px-6 pb-10">
          <p className="text-xs tracking-widest text-muted uppercase">
            Version <span className="font-mono normal-case">{version}</span>
          </p>
        </footer>
      )}
    </>
  );
}
