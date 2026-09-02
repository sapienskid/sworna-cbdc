import * as React from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import {
  Blocks,
  Building2,
  FileSearch,
  LayoutDashboard,
  ShieldCheck,
  Users,
  Wallet,
  KeyRound,
} from "lucide-react";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppShell, type NavGroup } from "@/components/app-shell";
import { LoginPage } from "@/pages/login";
import { CBDashboard } from "@/pages/cb/dashboard";
import { CBBanks } from "@/pages/cb/banks";
import { CBLedger } from "@/pages/cb/ledger";
import { CBCompliance } from "@/pages/cb/compliance";
import { CBPrivacy } from "@/pages/cb/privacy";
import { CBAdministration } from "@/pages/cb/administration";
import { BankDashboard } from "@/pages/bank/dashboard";
import { CustomerView } from "@/pages/customer";
import { Skeleton } from "@/components/ui/skeleton";

const CB_ROLES = ["cb_admin", "cb_mint_officer", "cb_auditor"];

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md space-y-3 p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireCBRole({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !CB_ROLES.includes(user.role)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

function CBLayout() {
  const groups: NavGroup[] = [
    {
      label: "Oversight",
      items: [
        { to: "/cb", label: "Dashboard", icon: LayoutDashboard, end: true },
        { to: "/cb/banks", label: "Banks", icon: Building2 },
        { to: "/cb/ledger", label: "Ledger & Transactions", icon: Blocks },
      ],
    },
    {
      label: "Supervision",
      items: [
        { to: "/cb/compliance", label: "AML Compliance", icon: FileSearch },
        { to: "/cb/privacy", label: "Privacy & Cryptography", icon: ShieldCheck },
      ],
    },
    {
      label: "Administration",
      items: [{ to: "/cb/administration", label: "Staff & Access", icon: KeyRound }],
    },
  ];
  return (
    <AppShell title="Central bank" subtitle="issuance & supervision console" groups={groups}>
      <Routes>
        <Route index element={<Page><CBDashboard /></Page>} />
        <Route path="banks" element={<Page><CBBanks /></Page>} />
        <Route path="ledger" element={<Page><CBLedger /></Page>} />
        <Route path="compliance" element={<Page><CBCompliance /></Page>} />
        <Route path="privacy" element={<Page><CBPrivacy /></Page>} />
        <Route path="administration" element={<Page><CBAdministration /></Page>} />
        <Route path="*" element={<Navigate to="/cb" replace />} />
      </Routes>
    </AppShell>
  );
}

function BankLayout() {
  const { user } = useAuth();
  const { code } = useParams<{ code: string }>();
  if (user?.role === "customer") {
    return (
      <AppShell
        title={`Bank ${user.bank_code}`}
        subtitle="customer wallet"
        groups={[
          {
            label: "Wallet",
            items: [{ to: `/b/${user.bank_code}`, label: "My account", icon: Wallet, end: true }],
          },
        ]}
      >
        <CustomerView />
      </AppShell>
    );
  }
  const groups: NavGroup[] = [
    {
      label: "Retail banking",
      items: [
        { to: `/b/${code}`, label: "Overview", icon: LayoutDashboard, end: true },
        { to: `/b/${code}/accounts`, label: "Customer accounts", icon: Users },
      ],
    },
  ];
  return (
    <AppShell title={`Bank ${code}`} subtitle="staff console" groups={groups}>
      <Routes>
        <Route index element={<Page><BankDashboard bankCode={code ?? ""} /></Page>} />
        <Route path="accounts" element={<Page><BankDashboard bankCode={code ?? ""} defaultTab="accounts" /></Page>} />
        <Route path="*" element={<Navigate to={`/b/${code}`} replace />} />
      </Routes>
    </AppShell>
  );
}

function GuardedBankPortal() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const location = useLocation();
  if (!user || CB_ROLES.includes(user.role)) return <Navigate to="/cb" replace />;
  if (user.bank_code && user.bank_code !== code)
    return <Navigate to={`/b/${user.bank_code}${location.pathname.split(/^\/b\/\d{3}/)[1] ?? ""}`} replace />;
  return <BankLayout />;
}

function LoginRedirect() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  if (user) {
    if (CB_ROLES.includes(user.role)) return <Navigate to="/cb" replace />;
    return <Navigate to={`/b/${user.bank_code ?? "001"}`} replace />;
  }
  return <LoginPage />;
}

// Each portal instance can be served under its own URL by running the dev
// server (or build) with a VITE_DEFAULT_PORTAL env var from an .env file,
// e.g. .env.portal-banka sets VITE_DEFAULT_PORTAL=banka.
function defaultPath(): string {
  switch (import.meta.env.VITE_DEFAULT_PORTAL) {
    case "cb":
      return "/cb";
    case "banka":
      return "/b/001";
    case "bankb":
      return "/b/002";
    default:
      return "/login";
  }
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRedirect />} />
          <Route
            path="/cb/*"
            element={
              <RequireAuth>
                <RequireCBRole>
                  <CBLayout />
                </RequireCBRole>
              </RequireAuth>
            }
          />
          <Route
            path="/b/:code/*"
            element={
              <RequireAuth>
                <GuardedBankPortal />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to={defaultPath()} replace />} />
        </Routes>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </AuthProvider>
  );
}
