/** Human labels for audit_log actions. */
export const AUDIT_ACTIONS: Record<string, string> = {
  "database.create": "Created database",
  "database.delete": "Deleted database",
  "database.reset": "Emptied database",
  "database.rename": "Renamed database",
  "database.export": "Downloaded a backup",
  "database.restore": "Restored a backup",
  "apikey.create": "Created API key",
  "apikey.revoke": "Revoked API key",
  "member.add": "Added member",
  "member.update": "Changed member role",
  "member.remove": "Removed member",
  "account.create": "Created database account",
  "account.update": "Updated database account",
  "account.delete": "Deleted database account",
  "admin.user.role": "Changed platform role",
  "admin.user.suspend": "Suspended user",
  "admin.user.restore": "Restored user",
  "admin.user.limit": "Changed database limit",
  "admin.database.limits": "Changed database limits",
  "admin.database.delete": "Deleted database (admin)",
  "admin.account.suspend": "Suspended database account",
  "admin.account.restore": "Restored database account",
  "admin.account.delete": "Deleted database account (admin)",
  "admin.announcement": "Sent an announcement",
  "user.delete": "Deleted account",
  "quota.ops": "Daily command budget reached",
  "quota.storage": "Storage limit reached",
};

export function auditLabel(action: string) {
  return AUDIT_ACTIONS[action] ?? action;
}
