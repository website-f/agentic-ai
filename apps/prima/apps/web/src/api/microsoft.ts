import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';

/** What the API says about sign-in (GET /api/auth/config). Tenant and client IDs are public, not secrets. */
export interface SignInConfig {
  microsoft: { tenantId: string; clientId: string; scope: string } | null;
  devLogin: boolean;
}

/**
 * Microsoft 365 sign-in for office staff (Entra ID, single tenant). The library loads only when the server has
 * Microsoft sign-in turned on, so the test link never carries it. Tokens stay in this tab's session storage.
 */
export class MicrosoftSignIn {
  private constructor(
    private app: PublicClientApplication,
    private scope: string,
  ) {}

  static async start(cfg: NonNullable<SignInConfig['microsoft']>): Promise<MicrosoftSignIn> {
    const { PublicClientApplication } = await import('@azure/msal-browser');
    const app = new PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
        // The app's own address: the site root, or its path beside another app (/prima/).
        redirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,
        postLogoutRedirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
    await app.initialize();
    // Coming back from the Microsoft page: keep the account it signed in.
    const back = await app.handleRedirectPromise();
    if (back?.account) app.setActiveAccount(back.account);
    else if (!app.getActiveAccount() && app.getAllAccounts().length === 1) app.setActiveAccount(app.getAllAccounts()[0]);
    return new MicrosoftSignIn(app, cfg.scope);
  }

  account(): AccountInfo | null {
    return this.app.getActiveAccount();
  }

  /** Goes to the Microsoft sign-in page (with MFA as the tenant requires) and comes back to Prima. */
  signIn(): Promise<void> {
    return this.app.loginRedirect({ scopes: [this.scope], prompt: 'select_account' });
  }

  /** A current access token for the Prima API, or null when the person must sign in again. */
  async token(): Promise<string | null> {
    const account = this.account();
    if (!account) return null;
    try {
      return (await this.app.acquireTokenSilent({ scopes: [this.scope], account })).accessToken;
    } catch {
      return null;
    }
  }

  /**
   * Sign in again for this account, e.g. after expiry, revoked consent or a claims challenge (MFA, Conditional Access,
   * continuous access evaluation). The claims string comes from Microsoft via Prima and is only passed back to Microsoft.
   */
  reauthenticate(claims?: string): Promise<void> {
    const account = this.account() ?? undefined;
    return this.app.acquireTokenRedirect({ scopes: [this.scope], account, ...(claims ? { claims } : {}), redirectStartPage: `${window.location.origin}/` });
  }

  signOut(): Promise<void> {
    return this.app.logoutRedirect({ account: this.account() ?? undefined });
  }
}
