import { TinfoilAttestationError } from './registry.js'
import type { TinfoilAttestationRegistry } from './registry.js'

/** Authenticated snapshot route. Keep in sync with `client.js`. */
export const SNAPSHOT_PATH = '/api/tinfoil/attestations'

/** Authenticated on-demand verification route. Keep in sync with `client.js`. */
export const VERIFY_PATH = '/api/tinfoil/attestations/verify'

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

/** Return the current registry snapshot as a no-store JSON response. */
export function snapshotResponse(registry: TinfoilAttestationRegistry): Response {
  return Response.json(registry.snapshot(), { headers: JSON_HEADERS })
}

/**
 * Run one plugin's attestation, or every verifiable target when no id is
 * supplied, and return the refreshed snapshot.
 * @param registry - live attestation registry.
 * @param request - authenticated POST request carrying `{ id? }`.
 * @returns the refreshed snapshot or a bounded domain error.
 */
export async function verifyResponse(
  registry: TinfoilAttestationRegistry,
  request: Request,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'invalid-request', 'Expected a JSON object with an optional id.')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'invalid-request', 'Expected a JSON object with an optional id.')
  }
  const supplied = (body as { id?: unknown }).id
  if (supplied !== undefined && (typeof supplied !== 'string' || supplied.length === 0 || supplied.length > 100)) {
    return errorResponse(400, 'invalid-request', 'Expected a non-empty string id.')
  }
  try {
    if (typeof supplied === 'string') {
      await registry.verify(supplied, request.signal)
    } else {
      const targets = registry.snapshot().entries.filter(entry => entry.canVerify)
      await Promise.allSettled(targets.map(entry => registry.verify(entry.id, request.signal)))
    }
    return snapshotResponse(registry)
  } catch (error) {
    if (error instanceof TinfoilAttestationError) {
      const status = error.code === 'unknown-target' ? 404 : 400
      return errorResponse(status, error.code, error.message)
    }
    return errorResponse(500, 'internal', 'Tinfoil verification failed unexpectedly.')
  }
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: JSON_HEADERS })
}
