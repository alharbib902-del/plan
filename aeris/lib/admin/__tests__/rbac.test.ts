import assert from 'node:assert/strict';

import { ADMIN_WRITE_ROLES, adminRoleAllowed } from '../rbac';

/**
 * SEC-01 least-privilege policy. ADMIN_WRITE_ROLES gates sensitive
 * admin writes to owner/admin; `support` is read + tickets + lead
 * triage only (Tier C handled by NOT passing roles on those actions).
 */

// owner + admin may perform sensitive write actions
assert.equal(adminRoleAllowed('owner', ADMIN_WRITE_ROLES), true);
assert.equal(adminRoleAllowed('admin', ADMIN_WRITE_ROLES), true);

// support may NOT perform sensitive write actions
assert.equal(adminRoleAllowed('support', ADMIN_WRITE_ROLES), false);

// support IS allowed where a Tier-C action explicitly permits it
assert.equal(
  adminRoleAllowed('support', ['owner', 'admin', 'support']),
  true
);

// ADMIN_WRITE_ROLES must never include support, and must include both
// privileged roles.
assert.ok(!ADMIN_WRITE_ROLES.includes('support'));
assert.ok(ADMIN_WRITE_ROLES.includes('owner'));
assert.ok(ADMIN_WRITE_ROLES.includes('admin'));

console.log('rbac.test: all assertions passed');
