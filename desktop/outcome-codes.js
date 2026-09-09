/**
 * Machine-readable outcome codes for a queued LinkedIn action.
 *
 * The runner has always produced a human `result` string — good for the log and
 * the status line, useless to anything that has to branch on what happened. A
 * "failed" that means "this account is throttled, stop the run" and a "failed"
 * that means "this one profile has no Connect, move on" read identically to the
 * server and the CRM. These codes make the distinction explicit without changing
 * the `status` enum the queue already understands.
 *
 * `code` travels alongside `status`/`result`, never instead of them. The server
 * stores it in activity metadata; nothing yet branches on it, so adding one is
 * always safe and removing one only loses a label.
 *
 * Self-contained CommonJS on purpose — required by connect-flow.js, pilot.js and
 * runner.js, all of which run in Node, not in the page.
 */
const CODES = {
  // Gate / preconditions.
  AUTOMATIC_SENDING_DISABLED: "AUTOMATIC_SENDING_DISABLED",
  LINKEDIN_SESSION_INVALID: "LINKEDIN_SESSION_INVALID",
  LINKEDIN_NAVIGATION_FAILED: "LINKEDIN_NAVIGATION_FAILED",

  // Identity.
  TARGET_PROFILE_NOT_FOUND: "TARGET_PROFILE_NOT_FOUND",
  TARGET_PROFILE_MISMATCH: "TARGET_PROFILE_MISMATCH",

  // Already-resolved states (reported as skipped, not failed).
  ALREADY_CONNECTED: "ALREADY_CONNECTED",
  INVITATION_PENDING: "INVITATION_PENDING",

  // Connect resolution.
  CONNECT_BUTTON_NOT_FOUND: "CONNECT_BUTTON_NOT_FOUND",
  CONNECT_BUTTON_AMBIGUOUS: "CONNECT_BUTTON_AMBIGUOUS",

  // Invitation dialog.
  INVITATION_DIALOG_NOT_FOUND: "INVITATION_DIALOG_NOT_FOUND",
  MESSAGE_FIELD_NOT_FOUND: "MESSAGE_FIELD_NOT_FOUND",
  SEND_BUTTON_NOT_FOUND: "SEND_BUTTON_NOT_FOUND",

  // Submission.
  INVITATION_SUBMITTED: "INVITATION_SUBMITTED",
  INVITATION_SUBMISSION_UNCONFIRMED: "INVITATION_SUBMISSION_UNCONFIRMED",
  LINKEDIN_LIMIT_REACHED: "LINKEDIN_LIMIT_REACHED",

  // The deterministic driver could not recognise the page and handed off to the
  // model. Not itself a failure — a marker that the fallback ran.
  DELEGATED_TO_MODEL: "DELEGATED_TO_MODEL",
};

module.exports = { CODES };
