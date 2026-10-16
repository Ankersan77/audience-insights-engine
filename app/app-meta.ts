/**
 * Identity of this deployment, injected through the runtime environment.
 *
 * Keeping these values outside the image lets the same build run in different
 * environments without baking deployment-specific identity into the bundle.
 * The fallbacks apply to local development.
 */

/** The application name shown in metadata and the landing page. */
export function getAppName(): string {
  return process.env.APPLICATION_NAME?.trim() || "Market Research";
}

/**
 * The deployed version: the short commit SHA CI built from, or a git tag name
 * for a tag build. Empty in local development, where there is no image.
 */
export function getAppVersion(): string | null {
  return process.env.APPLICATION_VERSION?.trim() || null;
}
