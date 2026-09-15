# Task and lead assignment notifications

**Last updated:** 2026-09-15
**Status:** stable

Followthroo notifies a teammate when work is assigned to them. Assignment
notifications have two independent delivery channels:

- an in-app notification, which is always created;
- a system email, when the recipient has an email address and their matching
  preference is enabled.

Self-assignment is intentionally silent. A task or lead write must also survive
notification and SMTP failures, so callers treat dispatch as best-effort.

## Dispatch flow

Task creation and reassignment call `notifyTaskAssigned()` in
[`lib/tasks.ts`](../lib/tasks.ts). Lead assignment paths call
`notifyLeadAssigned()` in [`lib/notifications.ts`](../lib/notifications.ts).
Both delegate to `notify()`:

1. Reject a missing recipient or self-action.
2. Write the in-app `Notification` row.
3. Resolve the recipient and read `User.notificationPrefs`.
4. If the relevant preference permits it, call `sendSystemEmailDetailed()`.
5. Return a `NotifyResult` and emit one structured diagnostic log entry.

`NotifyResult` distinguishes whether the bell row was created, whether email was
requested and permitted, whether SMTP was attempted, whether it succeeded, and
the safe error reason when it did not. Transport errors are reduced to their
message; Nodemailer's error object is never logged because it may include SMTP
configuration.

System email uses one pooled SMTP connection per warm server process, capped at
one connection and two messages per second. A transient socket close, reset, or
timeout discards the pool and retries once on a fresh connection. Authentication
and other permanent failures are not retried.

The log event is `TASK_ASSIGNED_NOTIFICATION` or
`LEAD_ASSIGNED_NOTIFICATION`. It includes recipient and branch outcomes but no
passwords, access tokens, refresh tokens, or mail transport objects.

## Preferences

[`lib/task-reminders.ts`](../lib/task-reminders.ts) owns the default-on preference
shape:

- `taskAssigned`
- `leadAssigned`
- `taskReminders`
- `dailyDigest`

Settings are exposed by
[`app/api/notifications/prefs/route.ts`](../app/api/notifications/prefs/route.ts)
and the Notifications settings page. Disabling an assignment preference blocks
only its email; the in-app notification still appears.

## Task lifecycle

[`lib/tasks.ts`](../lib/tasks.ts) raises an assignment notification when a task is
created with another owner, or when an existing task's `ownerId` changes. Editing
other fields or re-saving the same owner does not notify again. The same path is
used for system-created reply follow-ups.

Task writes catch dispatch errors after the database write, so an unavailable
notification table or mail server never rolls back the task itself.

## UI and API

[`components/dashboard/NotificationBell.tsx`](../components/dashboard/NotificationBell.tsx)
polls [`app/api/notifications/route.ts`](../app/api/notifications/route.ts) for
recent items, the active workspace's unread count, and unread counts in other
workspaces. Read mutations are scoped by both organization and recipient.

## Verification

Run:

```bash
npx tsx --env-file=.env scripts/verify-notifications.ts
```

The script verifies creation, self-assignment suppression, unowned tasks,
reassignment, same-owner saves, email preference gating, missing recipients,
SMTP failure isolation, lead-assignment batching, read state, and recipient
isolation. It sets the call-time `SYSTEM_EMAIL_DRY_RUN` guard and disables SMTP
before dynamically importing application configuration, uses
throwaway rows, and cleans those rows in a retrying `finally` block because this
repository has only the production Supabase database.
