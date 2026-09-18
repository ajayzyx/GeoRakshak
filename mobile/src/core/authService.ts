import { ApiClient } from './api';
import { toApiError } from './http';
import { KeyValueStore } from './localCache';
import { Clock, Role, User } from './types';

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const TOKEN_KEY = 'georakshak_access_token';
const USER_KEY = 'session:user';

export type AppMode = 'FIELD' | 'CITIZEN' | 'UNSUPPORTED';

/** FIELD_OFFICER → field mode, CITIZEN → citizen mode. Authority/admin roles use the web dashboard. */
export function modeForRole(role: Role): AppMode {
  if (role === 'FIELD_OFFICER') return 'FIELD';
  if (role === 'CITIZEN') return 'CITIZEN';
  return 'UNSUPPORTED';
}

export interface RestoredSession {
  user: User;
  /** true when the profile came from the device cache because the server was unreachable. */
  offline: boolean;
}

export const LANGUAGE_OPTIONS: { code: string; label: string; enabled: boolean }[] = [
  { code: 'en', label: 'English', enabled: true },
  { code: 'hi', label: 'हिन्दी (Hindi)', enabled: true },
  // H9: one pilot-area language. The pilot area is not selected yet (A12), so
  // there is no language code to send. Enabled once the area is chosen.
  { code: 'pilot', label: 'Pilot-area language (not yet selected)', enabled: false },
];

export class AuthService {
  private user: User | null = null;
  private token: string | null = null;

  constructor(
    private readonly deps: { api: ApiClient; secrets: SecretStore; cache: KeyValueStore; clock: Clock },
  ) {}

  get currentUser(): User | null {
    return this.user;
  }

  /** Token getter handed to ApiClient. */
  readonly getToken = async (): Promise<string | null> => {
    if (this.token === null) this.token = await this.deps.secrets.get(TOKEN_KEY);
    return this.token;
  };

  async login(email: string, password: string): Promise<User> {
    const res = await this.deps.api.login(email.trim(), password);
    this.token = res.access_token;
    await this.deps.secrets.set(TOKEN_KEY, res.access_token);
    await this.setUser(res.user);
    return res.user;
  }

  /**
   * Restores a session on app start. Offline-first: if the server cannot be
   * reached, the cached profile is used so queued work and cached alerts stay
   * available. A 401 clears the session.
   */
  async restore(): Promise<RestoredSession | null> {
    const token = await this.getToken();
    if (!token) return null;
    try {
      const user = await this.deps.api.me();
      await this.setUser(user);
      return { user, offline: false };
    } catch (err) {
      const e = toApiError(err);
      if (e.kind === 'unauthenticated') {
        await this.clearSession();
        return null;
      }
      const cached = await this.deps.cache.get<User>(USER_KEY);
      if (!cached) return null;
      this.user = cached.value;
      return { user: cached.value, offline: true };
    }
  }

  async updateLanguage(code: string): Promise<User> {
    const option = LANGUAGE_OPTIONS.find((o) => o.code === code);
    if (!option?.enabled) throw new Error(`Language "${code}" is not available yet.`);
    const user = await this.deps.api.updatePreferredLanguage(code);
    await this.setUser(user);
    return user;
  }

  /** Clears the token and profile. Queued reports stay on the device and sync at the owner's next sign-in. */
  async logout(): Promise<void> {
    await this.clearSession();
  }

  private async clearSession(): Promise<void> {
    this.token = null;
    this.user = null;
    await this.deps.secrets.remove(TOKEN_KEY);
    await this.deps.cache.remove(USER_KEY);
  }

  private async setUser(user: User): Promise<void> {
    this.user = user;
    await this.deps.cache.set(USER_KEY, user, this.deps.clock.now().toISOString());
  }
}
