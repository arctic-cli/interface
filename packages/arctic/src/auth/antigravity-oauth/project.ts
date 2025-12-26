import {
  ANTIGRAVITY_HEADERS,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_LOAD_ENDPOINTS,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
} from "./constants";
import { formatRefreshParts, parseRefreshParts } from "./auth-helpers";
import type { OAuthAuthDetails, ProjectContextResult } from "./types";

const CODE_ASSIST_METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const;

interface LoadCodeAssistPayload {
  cloudaicompanionProject?: string | { id?: string };
  currentTier?: {
    id?: string;
  };
  allowedTiers?: Array<{
    id?: string;
    isDefault?: boolean;
    userDefinedCloudaicompanionProject?: boolean;
  }>;
}

/**
 * Builds metadata headers required by the Code Assist API.
 */
function buildMetadata(projectId?: string): Record<string, string> {
  const metadata: Record<string, string> = {
    ideType: CODE_ASSIST_METADATA.ideType,
    platform: CODE_ASSIST_METADATA.platform,
    pluginType: CODE_ASSIST_METADATA.pluginType,
  };
  if (projectId) {
    metadata.duetProject = projectId;
  }
  return metadata;
}

/**
 * Extracts the cloudaicompanion project id from loadCodeAssist responses.
 */
function extractManagedProjectId(payload: LoadCodeAssistPayload | null): string | undefined {
  if (!payload) {
    return undefined;
  }
  if (typeof payload.cloudaicompanionProject === "string") {
    return payload.cloudaicompanionProject;
  }
  if (payload.cloudaicompanionProject && typeof payload.cloudaicompanionProject.id === "string") {
    return payload.cloudaicompanionProject.id;
  }
  return undefined;
}

/**
 * Loads managed project information for the given access token and optional project.
 */
export async function loadManagedProject(
  accessToken: string,
  projectId?: string,
): Promise<LoadCodeAssistPayload | null> {
  const metadata = buildMetadata(projectId);
  const requestBody: Record<string, unknown> = { metadata };

  const loadHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": ANTIGRAVITY_HEADERS["Client-Metadata"],
  };

  const loadEndpoints = Array.from(
    new Set<string>([...ANTIGRAVITY_LOAD_ENDPOINTS, ...ANTIGRAVITY_ENDPOINT_FALLBACKS]),
  );

  for (const baseEndpoint of loadEndpoints) {
    try {
      const response = await fetch(`${baseEndpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: loadHeaders,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        continue;
      }

      return (await response.json()) as LoadCodeAssistPayload;
    } catch (error) {
      console.error(`Failed to load Antigravity managed project via ${baseEndpoint}:`, error);
      continue;
    }
  }

  return null;
}

/**
 * Resolves an effective project ID for the current auth state.
 * Returns auth with potentially updated managedProjectId in refresh token.
 */
export async function resolveProjectContext(auth: OAuthAuthDetails): Promise<ProjectContextResult> {
  const accessToken = auth.access;
  if (!accessToken) {
    return { auth, effectiveProjectId: "" };
  }

  const parts = parseRefreshParts(auth.refresh);

  // If we already have a managedProjectId, use it
  if (parts.managedProjectId) {
    return { auth, effectiveProjectId: parts.managedProjectId };
  }

  const fallbackProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID;

  // Try to resolve a managed project from Antigravity
  const loadPayload = await loadManagedProject(accessToken, parts.projectId ?? fallbackProjectId);
  const resolvedManagedProjectId = extractManagedProjectId(loadPayload);

  if (resolvedManagedProjectId) {
    // Update auth with resolved managed project ID
    const updatedAuth: OAuthAuthDetails = {
      ...auth,
      refresh: formatRefreshParts({
        refreshToken: parts.refreshToken,
        projectId: parts.projectId,
        managedProjectId: resolvedManagedProjectId,
      }),
    };
    return { auth: updatedAuth, effectiveProjectId: resolvedManagedProjectId };
  }

  // Fall back to stored project ID or default
  const effectiveProjectId = parts.projectId ?? fallbackProjectId;
  return { auth, effectiveProjectId };
}

/**
 * Discovers a managed project ID for the given access token.
 * Returns the managed project ID if found, otherwise undefined.
 */
export async function discoverManagedProjectId(
  accessToken: string,
  projectId?: string,
): Promise<string | undefined> {
  const loadPayload = await loadManagedProject(accessToken, projectId ?? ANTIGRAVITY_DEFAULT_PROJECT_ID);
  return extractManagedProjectId(loadPayload);
}
