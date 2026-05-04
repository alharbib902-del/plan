// Phase 3.5.1 Verification PR — INTENTIONAL TYPE ERROR.
// This file exists only to prove that a red CI run blocks merge to
// the protected `main` branch. It must never be merged. The PR
// containing this file will be CLOSED without merging, and this
// file will be removed when the verify/protection-rule branch is
// deleted.
const _verify: number = "this should be a number, not a string";
export {};
