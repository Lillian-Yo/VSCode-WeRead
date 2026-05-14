export type AccountId = string;

export interface AccountProfile {
  accountId: AccountId;
  userId?: string;
  wrVid?: string;
  displayName: string;
  avatar?: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface AccountsMeta {
  version: 1;
  accounts: AccountProfile[];
}

export interface AccountContext {
  accountId: AccountId;
}

export const ACCOUNT_META_VERSION = 1 as const;
