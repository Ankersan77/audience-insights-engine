/**
 * Identity of this deployment, injected at runtime by the Helm chart.
 *
 * Both values come from the chart rather than the image so that one build is
 * never tied to one app, and so the version can never drift from the image that
 * is actually running. See the env block in
 * k8s/APP_NAME/templates/deployment.yaml.
 *
 * Neither is named APP_NAME: scaffolding rewrites that literal throughout k8s/
 * when it renames the chart folder, which would rename the variable in
 * deployment.yaml but not here, and the app would silently fall back.
 *
 * The fallbacks only apply to `pnpm dev`, where no chart is involved.
 */

/** The app's own name — .Chart.Name, i.e. the repo minus the better-craft- prefix. */
export function getAppName(): string {
  return process.env.APPLICATION_NAME?.trim() || "better-craft";
}

/**
 * The deployed version: the short commit SHA CI built from, or a git tag name
 * for a tag build. Empty in local development, where there is no image.
 */
export function getAppVersion(): string | null {
  return process.env.APPLICATION_VERSION?.trim() || null;
}
