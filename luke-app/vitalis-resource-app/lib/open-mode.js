/**
 * open-mode.js — the single source of truth for the TEST/OPEN-MODE flag.
 *
 * `VITALIS_OPEN_MODE` is an ENV VAR, default OFF. When OFF (production AND the existing
 * test suite), the server behaves exactly as before — every entitlement, ack/attestation
 * PROMPT, and silo gate is enforced. When ON (`VITALIS_OPEN_MODE=1`), the server removes
 * generation FRICTION so the team can test the generators wide-open:
 *   - no entitlement block (no active-protocol cap 409, no included-credit/$25 overage 402)
 *   - the one-time jurisdiction notice + license-ack + practitioner-attestation PROMPTS are
 *     auto-satisfied (the APPROVE transition itself is unchanged — only the prompt friction is)
 *   - every silo is generable (no silo lock)
 *   - the nav surfaces a discoverable "Generate" group (client reads openMode from /api/config)
 *
 * OPEN_MODE removes FRICTION, it does NOT open the SECURITY MODEL. The approval→visibility
 * boundary, the no-draft-leak client projections, the surfaced compliance flags, the language
 * gate, and selfIntakeApprovalGate all stay fully enforced regardless of this flag.
 *
 * Read at CALL TIME (never cached) so the flag is runtime-toggleable: restart the server with
 * the env set (`VITALIS_OPEN_MODE=1 node server.js`) — no rebuild — and so the test suite can
 * set/restore `process.env.VITALIS_OPEN_MODE` around individual open-mode assertions.
 */
'use strict';

function isOpenMode() {
  return process.env.VITALIS_OPEN_MODE === '1';
}

module.exports = { isOpenMode };
