import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { TinfoilAttestationRegistryImpl } from './registry.js'
import { SNAPSHOT_PATH, VERIFY_PATH, snapshotResponse, verifyResponse } from './routes.js'

export {
  TINFOIL_ROUTER_CONFIG_REPO,
  TINFOIL_ROUTER_ORIGIN,
  TinfoilAttestationError,
  TinfoilAttestationRegistryImpl,
} from './registry.js'
export type {
  TinfoilAttestationEntry,
  TinfoilAttestationMode,
  TinfoilAttestationRegistry,
  TinfoilAttestationSnapshot,
  TinfoilAttestationState,
  TinfoilAttestationTarget,
} from './registry.js'
export { SNAPSHOT_PATH, VERIFY_PATH } from './routes.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tinfoil-verification'

/**
 * Publish the attestation registry and its authenticated browser routes.
 *
 * The registry is provided immediately so capability plugins can register in
 * any composition. The routes activate only where `ctx.connection` exists
 * (the Web host); in headless and SDK profiles the registry stays available
 * and no HTTP surface is added.
 * @param ctx - host plugin context.
 */
export function apply(ctx: Context): void {
  const registry = new TinfoilAttestationRegistryImpl()
  ctx.provide('tinfoilAttestation', registry)
  ctx.inject(['connection'], (routeCtx) => {
    routeCtx.effect(() => routeCtx.connection.fetch.register({
      path: SNAPSHOT_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => Promise.resolve(snapshotResponse(registry)),
    }), 'tinfoil-verification: snapshot route')
    routeCtx.effect(() => routeCtx.connection.fetch.register({
      path: VERIFY_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => verifyResponse(registry, request),
    }), 'tinfoil-verification: verify route')
  })
}
