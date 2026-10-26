// Our view of a Unipile account. Nothing outside lib/unipile sees Unipile's wire format.
export type UnipileAccount = {
  id: string;
  type: string; // "LINKEDIN", ...
  displayName: string | null;
  rawStatus: string; // from sources[].status (see extractRawStatus)
  providerUserId: string | null; // LinkedIn member id, for duplicate detection
  publicIdentifier: string | null;
  profileUrl: string | null;
};

export type HostedAuthOpts = {
  type: "create" | "reconnect";
  personId: string;
  reconnectAccountId?: string;
  expiresInMin?: number;
};

export interface UnipileClient {
  createHostedAuthLink(opts: HostedAuthOpts): Promise<{ url: string }>;
  getAccount(accountId: string): Promise<UnipileAccount | null>; // null = 404
  listAccounts(): Promise<UnipileAccount[]>; // throws on failure; never returns a partial list
  deleteAccount(accountId: string): Promise<void>; // 404 = success
  ensureAccountStatusWebhook(): Promise<void>;
}

export class UnipileError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
