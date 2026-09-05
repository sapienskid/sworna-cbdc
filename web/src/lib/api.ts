// Typed API client for the Sworna banking backend.
const BASE = "/api/v1";

export type Role = "cb_admin" | "bank_staff" | "customer";

export interface LoginResponse {
  token: string;
  role: Role;
  username: string;
  bank_code: string | null;
  account_number: string | null;
}

export interface BankPermissions {
  can_redeem: boolean;
  interbank_limit_minor: number;
  redeem_limit_minor: number;
}

export interface Bank {
  id: number;
  code: string;
  name: string;
  msp_id: string;
  owner_node: string;
  portal_url: string;
  status: "registered" | "active" | "suspended";
  permissions: BankPermissions;
  pool_size: number;
  joined_at: string | null;
}

export interface Account {
  id: number;
  account_number: string;
  full_name: string;
  status: "active" | "flagged" | "frozen";
  kyc_level: number;
  bank_code: string;
  bank_name: string;
  transfer_limit: string;
}

export interface Balance {
  account_number: string;
  full_name: string;
  bank_code: string;
  balance: string;
}

export interface StatementItem {
  txid: string;
  amount: number;
  reference: string;
  sender: string;
  recipient: string;
  status: string;
  timestamp: string;
}

export interface TxLog {
  txid: string;
  tx_type: string;
  from_account: string;
  to_account: string;
  amount: string;
  reference: string;
  status: string;
  created_at: string;
}

export interface CirculationRow {
  bank_code: string;
  bank_name: string;
  status: Bank["status"];
  total_minor: number;
  total: string;
  account_count: number;
  wallet_errors: number;
}

export interface Overview {
  total_supply: string;
  circulation: CirculationRow[];
  wallets_unreachable: number;
}

export interface AMLAlert {
  id: number;
  rule: string;
  severity: "low" | "medium" | "high";
  status: "open" | "reviewed" | "dismissed";
  account_number: string;
  bank_code: string;
  counterparty: string;
  txid: string;
  amount: string;
  details: string;
  reviewed_by: string;
  reviewed_at: string | null;
  created_at: string;
}

export interface AMLSummary {
  open_alerts: number;
  open_by_severity: Record<string, number>;
  flagged_accounts: number;
  watchlist_entries: number;
  reportable_threshold: string;
  kyc_tiers: Record<string, { label: string; per_tx_minor: number; daily_minor: number; daily_count: number }>;
}

export interface WatchlistEntry {
  id: number;
  list_type: "sanction" | "pep" | "internal";
  value: string;
  note: string;
  active: boolean;
  created_by: string;
  created_at: string;
}

export interface OnboardingApplication {
  id: number;
  bank_code: string;
  legal_name: string;
  msp_id: string;
  owner_node: string;
  peer_endpoint: string;
  ca_endpoint: string;
  portal_url: string;
  pool_size: number;
  status: string;
  created_at: string;
}

export interface CryptoParams {
  identifier: string;
  curve_id: number;
  idemix_curve_id: number;
  quantity_precision: number;
  max_token: number;
  range_proof: { exponent: number | null; base: number };
  issuers: number;
  idemix_issuer_pk_fingerprint: string;
  auditor: { msp_id: string; cert_fingerprint: string };
  pedersen_generators_fingerprint: string;
  params_file: string;
  params_valid: boolean;
}

export interface WalletCryptoInfo {
  account_number: string;
  full_name: string;
  wallet: string;
  key_type: string;
  credential_fingerprint: string | null;
}

export interface ProvisionResult {
  bank_code: string;
  bank_name: string;
  owner_node: string;
  wallets_generated: number;
  used: number;
  free: number;
}

export interface UserRead {
  id: number;
  username: string;
  role: string;
  bank_code: string | null;
  account_number: string | null;
  created_at: string;
}

export interface LedgerStatus {
  channel: string;
  height: number;
  blocks: { number: number; tx_count: number; txids: string[] }[];
}

let token: string | null = localStorage.getItem("sworna_token");

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("sworna_token", t);
  else localStorage.removeItem("sworna_token");
}
export function getToken(): string | null {
  return token;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(BASE + path, { ...options, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    let message: string;
    if (typeof data.detail === "string") message = data.detail;
    else if (data.detail != null) message = JSON.stringify(data.detail);
    else message = `Request failed (${resp.status})`;
    if (resp.status === 401) setToken(null);
    throw new ApiError(resp.status, message);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<LoginResponse>("/auth/me"),

  banks: () => request<Bank[]>("/banks"),
  createBank: (body: {
    code: string;
    name: string;
    msp_id: string;
    owner_node: string;
    portal_url?: string;
    staff_username?: string;
    pool_size: number;
  }) => request<Bank>("/banks", { method: "POST", body: JSON.stringify(body) }),
  provision: (code: string) =>
    request<ProvisionResult>(`/admin/banks/${code}/provision`, { method: "POST" }),
  setBankStatus: (code: string, status: Bank["status"]) =>
    request<Bank>(`/banks/${code}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  setBankPermissions: (code: string, permissions: BankPermissions) =>
    request<Bank>(`/banks/${code}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ permissions }),
    }),

  accounts: () => request<Account[]>("/accounts"),
  onboard: (body: { full_name: string; username: string; password: string; kyc_level: number; transfer_limit: string }) =>
    request<Account>("/accounts", { method: "POST", body: JSON.stringify(body) }),
  setAccountStatus: (account_number: string, status: Account["status"]) =>
    request<Account>(`/accounts/${account_number}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  balance: (account_number: string) =>
    request<Balance>(`/accounts/${account_number}/balance`),
  statements: (account_number: string) =>
    request<StatementItem[]>(`/accounts/${account_number}/statements`),

  bankReserve: () => request<Balance>("/bank/reserve"),
  deposit: (body: { account_number: string; amount: string; reference?: string }) =>
    request<TxLog>("/bank/deposit", { method: "POST", body: JSON.stringify(body) }),
  withdraw: (body: { account_number: string; amount: string; reference?: string }) =>
    request<TxLog>("/bank/withdraw", { method: "POST", body: JSON.stringify(body) }),

  transfer: (body: { from_account: string; to_account: string; amount: string; reference: string }) =>
    request<TxLog>("/payments/transfer", { method: "POST", body: JSON.stringify(body) }),
  redeem: (body: { account: string; amount: string; reference: string }) =>
    request<TxLog>("/payments/redeem", { method: "POST", body: JSON.stringify(body) }),

  mint: (body: { bank_code: string; amount: string; reference?: string }) =>
    request<TxLog>("/admin/mint", { method: "POST", body: JSON.stringify(body) }),
  allocate: (body: { from_bank_code: string; to_bank_code: string; amount: string; reference?: string }) =>
    request<TxLog>("/admin/allocate", { method: "POST", body: JSON.stringify(body) }),
  burn: (body: { bank_code: string; amount: string; reference?: string }) =>
    request<TxLog>("/admin/burn", { method: "POST", body: JSON.stringify(body) }),
  cbUsers: () => request<UserRead[]>("/admin/users"),
  createCbUser: (body: { username: string; password: string; role: string; full_name?: string }) =>
    request<UserRead>("/admin/users", { method: "POST", body: JSON.stringify(body) }),

  issue: (body: { to_account?: string; bank_code?: string; amount: string; reference?: string }) =>
    request<TxLog>("/admin/mint", { method: "POST", body: JSON.stringify(body) }),
  overview: () => request<Overview>("/admin/overview"),
  transactions: () => request<TxLog[]>("/admin/transactions"),
  ledger: () => request<LedgerStatus>("/admin/ledger"),

  accountBalances: () =>
    request<{ account_number: string; balance: string }[]>("/accounts/balances"),

  amlSummary: () => request<AMLSummary>("/admin/aml/summary"),
  amlAlerts: (params: { status?: string; severity?: string; bank_code?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    ).toString();
    return request<AMLAlert[]>(`/admin/aml/alerts${qs ? `?${qs}` : ""}`);
  },
  reviewAlert: (id: number, status: AMLAlert["status"], note = "") =>
    request<AMLAlert>(`/admin/aml/alerts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    }),
  watchlist: () => request<WatchlistEntry[]>("/admin/aml/watchlist"),
  addWatchlistEntry: (body: { list_type: WatchlistEntry["list_type"]; value: string; note: string }) =>
    request<WatchlistEntry>("/admin/aml/watchlist", { method: "POST", body: JSON.stringify(body) }),
  deactivateWatchlistEntry: (id: number) =>
    request<void>(`/admin/aml/watchlist/${id}`, { method: "DELETE" }),

  cryptoParams: () => request<CryptoParams>("/admin/crypto/params"),
  cryptoWallets: () => request<WalletCryptoInfo[]>("/admin/crypto/wallets"),

  onboardingApplications: () => request<OnboardingApplication[]>("/onboarding/applications"),
  admitBankFast: (code: string) =>
    request<OnboardingApplication>(`/onboarding/applications/${code}/admit-fast`, { method: "POST" }),
};