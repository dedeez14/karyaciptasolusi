import { create } from 'zustand';
import { api, refreshToken, session } from '@/lib/api';
import { setLocale } from '@/lib/format';

export interface MenuNode {
  id: string;
  code: string;
  label: string;
  icon: string | null;
  path: string | null;
  children: MenuNode[];
}

export interface Me {
  user: { id: string; username: string; email: string; fullName: string; mustChangePassword: boolean; isSuperAdmin: boolean; lastLoginAt: string | null; mfaEnabled: boolean; mfaSetupRequired: boolean };
  company: { id: string; code: string; name: string; currencyCode: string; logoFileId: string | null };
  branchId: string | null;
  dataScope: string;
  permissions: string[];
  companies: { id: string; code: string; name: string }[];
  branches: { id: string; code: string; name: string }[];
  menus: MenuNode[];
  prefs: { locale: string; idleTimeoutMinutes: number; appName: string; timezone: string };
  clock: { enabled: boolean; timezone: string; format24h: boolean; showSeconds: boolean; showDate: boolean; label: string };
  /** employee record linked to this user (self-service attendance) */
  employeeId: string | null;
}

interface SessionState {
  status: 'loading' | 'anonymous' | 'authenticated';
  me: Me | null;
  perms: Set<string>;
  bootstrap: () => Promise<void>;
  /** returns a challenge when the account uses two-factor sign-in */
  login: (username: string, password: string) => Promise<{ mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  verifiedLogin: (accessToken: string) => Promise<void>;
  reload: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  switchBranch: (branchId: string | null) => Promise<void>;
  can: (perm: string) => boolean;
}

// only the selected company/branch ids are persisted (no tokens, no personal data)
const CTX_KEY = 'kcs.ctx';
const loadCtx = (): { c: string | null; b: string | null } => {
  try {
    return JSON.parse(localStorage.getItem(CTX_KEY) ?? '') ?? { c: null, b: null };
  } catch {
    return { c: null, b: null };
  }
};
const saveCtx = (c: string | null, b: string | null) => localStorage.setItem(CTX_KEY, JSON.stringify({ c, b }));

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  me: null,
  perms: new Set(),

  async reload() {
    const me = await api.get<Me>('/auth/me');
    session.setContext(me.company.id, me.branchId);
    saveCtx(me.company.id, me.branchId);
    setLocale(me.prefs.locale);
    document.title = me.prefs.appName;
    set({ me, perms: new Set(me.permissions), status: 'authenticated' });
  },

  async bootstrap() {
    const ctx = loadCtx();
    session.setContext(ctx.c, ctx.b);
    if (await refreshToken()) {
      try {
        await get().reload();
        return;
      } catch {
        session.setContext(null, null);
        try {
          await get().reload();
          return;
        } catch {
          /* fallthrough */
        }
      }
    }
    set({ status: 'anonymous', me: null });
  },

  async login(username, password) {
    const r = await api.post<{ accessToken?: string; mfaRequired?: boolean; mfaToken?: string }>('/auth/login', { username, password });
    if (r.mfaRequired && r.mfaToken) return { mfaToken: r.mfaToken };
    await get().verifiedLogin(r.accessToken!);
    return {};
  },

  async verifyMfa(mfaToken, code) {
    const r = await api.post<{ accessToken: string }>('/auth/mfa/verify', { mfaToken, code });
    await get().verifiedLogin(r.accessToken);
  },

  async verifiedLogin(accessToken: string) {
    session.setToken(accessToken);
    const ctx = loadCtx();
    session.setContext(ctx.c, ctx.b);
    try {
      await get().reload();
    } catch {
      session.setContext(null, null);
      await get().reload();
    }
  },

  async logout() {
    await api.post('/auth/logout').catch(() => undefined);
    session.setToken(null);
    set({ status: 'anonymous', me: null, perms: new Set() });
  },

  async switchCompany(companyId) {
    session.setContext(companyId, null);
    await refreshToken();
    await get().reload();
  },

  async switchBranch(branchId) {
    session.setContext(get().me!.company.id, branchId);
    await get().reload();
  },

  can(perm) {
    const p = get().perms;
    return p.has('*') || p.has(perm);
  },
}));

session.onAuthLost(() => useSession.setState({ status: 'anonymous', me: null, perms: new Set() }));
