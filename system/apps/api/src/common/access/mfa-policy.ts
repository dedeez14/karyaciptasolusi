import type { AuthUser } from '../context/request-context';
import type { SettingsService } from '../settings/settings.service';

/** permissions that make an account an administrator for the two-factor policy */
export const MFA_ADMIN_PERMISSIONS = ['system.user.update', 'system.role.update', 'system.setting.update', 'system.security.update'];

/** true when the company policy requires this user to sign in with a second factor */
export async function mfaRequiredFor(user: AuthUser, settings: SettingsService): Promise<boolean> {
  if (!(await settings.bool('security.mfaRequiredForAdmins', null, true))) return false;
  return user.isSuperAdmin || MFA_ADMIN_PERMISSIONS.some((p) => user.permissions.has(p));
}
