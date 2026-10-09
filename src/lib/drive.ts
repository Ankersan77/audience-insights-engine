import { createSign } from "node:crypto";

/**
 * Google Drive folder lookup, used by the Drive picker on the Channel
 * management screen (T16). Authenticates as a service account
 * (`GOOGLE_DRIVE_CREDENTIALS_JSON`, provisioned in SSM — see `.env.example`)
 * with the `drive.readonly` scope and calls the Drive v3 `files.list`
 * endpoint. No new dependency: the service-account JWT is signed with Node's
 * built-in `crypto` rather than adding `googleapis`/`google-auth-library`.
 *
 * `GOOGLE_DRIVE_CREDENTIALS_JSON` is not provisioned in this environment
 * (Credential-blocked epics, E5): there is no live round trip to verify yet.
 * The honest-failure path below (`DriveNotConfiguredError`) is what the UI
 * renders instead of crashing or faking folder data. Drive **write** delivery
 * is a separate, longer-term gap (spec FR9) — this module only ever reads.
 */

export type DriveFolderOption = {
  id: string;
  name: string;
};

/** Thrown when `GOOGLE_DRIVE_CREDENTIALS_JSON` is absent or unparsable. */
export class DriveNotConfiguredError extends Error {
  constructor(message = "Drive isn't connected yet.") {
    super(message);
    this.name = "DriveNotConfiguredError";
  }
}

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
};

function parseCredentials(raw: string): ServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DriveNotConfiguredError("Drive isn't connected yet.");
  }
  const candidate = parsed as Partial<ServiceAccountCredentials>;
  if (!candidate.client_email || !candidate.private_key) {
    throw new DriveNotConfiguredError("Drive isn't connected yet.");
  }
  return { client_email: candidate.client_email, private_key: candidate.private_key };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Signs a Google OAuth2 service-account JWT and exchanges it for a short-lived access token. */
async function getAccessToken(credentials: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth token error: ${data.error_description ?? data.error ?? response.statusText}`);
  }
  return data.access_token;
}

/** Searches folders (not files) the service account can see, by name substring. */
export async function searchFolders(query: string): Promise<DriveFolderOption[]> {
  const raw = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
  if (!raw) {
    throw new DriveNotConfiguredError();
  }
  const credentials = parseCredentials(raw);
  const accessToken = await getAccessToken(credentials);

  const clauses = ["mimeType = 'application/vnd.google-apps.folder'", "trashed = false"];
  const needle = query.trim();
  if (needle) {
    clauses.push(`name contains '${needle.replace(/'/g, "\\'")}'`);
  }

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", clauses.join(" and "));
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "25");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await response.json()) as {
    files?: Array<{ id: string; name: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(`Google Drive API error: ${data.error?.message ?? response.statusText}`);
  }
  return (data.files ?? []).map((f) => ({ id: f.id, name: f.name }));
}
