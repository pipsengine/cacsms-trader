export async function register() {
  // Runtime bootstrap runs via /api/system/runtime-bootstrap (docker-start.mjs)
  // to avoid Edge bundler pulling Node-only modules when middleware.ts is present.
}
