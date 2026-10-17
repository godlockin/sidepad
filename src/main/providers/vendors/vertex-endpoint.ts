/** Parsed Claude-on-Vertex project + region from the baseURL field. */
export interface VertexEndpoint {
  projectId: string;
  region: string;
}

/**
 * Accepts `projectId@region`, `projectId:region`, or
 * `https://…/projects/PROJECT/locations/REGION/…`.
 */
export function parseVertexEndpoint(baseURL?: string | null): VertexEndpoint {
  const v = (baseURL ?? '').trim();
  if (!v) {
    throw new Error('baseURL required for anthropic-vertex (projectId@region)');
  }

  if (/^https?:\/\//i.test(v)) {
    const m = v.match(/\/projects\/([^/]+)\/locations\/([^/]+)/i);
    if (!m) {
      throw new Error('Vertex URL must include /projects/{id}/locations/{region}');
    }
    return { projectId: m[1]!, region: m[2]! };
  }

  const at = v.match(/^([^@:\s]+)[@:](.+)$/);
  if (at) {
    return { projectId: at[1]!.trim(), region: at[2]!.trim() };
  }

  throw new Error('expected projectId@region (e.g. my-gcp-project@us-east5)');
}
