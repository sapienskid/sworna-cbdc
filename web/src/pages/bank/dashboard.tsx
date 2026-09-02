import * as React from "react";
import {
  UserPlus, Send, ArrowDownLeft, ArrowUpRight, Vault, Users, ShieldAlert, RefreshCcw, Download,
} from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/kit";
import { api, type Account, type Balance } from "@/lib/api";
import { downloadCsv, fmtSwr } from "@/lib/format";
import { toast } from "sonner";

const onboardSchema = z.object({
  full_name: z.string().min(1, "Full name required"),
  username: z.string().min(3, "Username min 3 characters"),
  password: z.string().min(6, "Password min 6 characters"),
  kyc_level: z.string().min(1, "KYC level required"),
  transfer_limit: z.string().min(1, "Limit required"),
});

const cashSchema = z.object({
  account_number: z.string().min(1, "Select customer account"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

const transferSchema = z.object({
  from_account: z.string().min(1, "Sender account required"),
  to_account: z.string().min(1, "Recipient account required"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

const KYC_LABELS: Record<string, string> = {
  "0": "T0 · Unverified",
  "1": "T1 · Basic",
  "2": "T2 · Verified",
  "3": "T3 · Enhanced",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "secondary",
  flagged: "destructive",
  frozen: "outline",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant={STATUS_VARIANT[status] ?? "outline"} className="capitalize">
        {status}
      </Badge>
      {status === "flagged" && (
        <span className="text-[10px] text-muted-foreground">payments blocked</span>
      )}
      {status === "frozen" && (
        <span className="text-[10px] text-muted-foreground">locked</span>
      )}
    </div>
  );
}

export function BankDashboard({
  bankCode,
  defaultTab = "overview",
}: {
  bankCode: string;
  defaultTab?: string;
}) {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [balances, setBalances] = React.useState<Record<string, string>>({});
  const [reserve, setReserve] = React.useState<Balance | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [onboardOpen, setOnboardOpen] = React.useState(false);

  const onboardForm = useForm<z.infer<typeof onboardSchema>>({
    resolver: zodResolver(onboardSchema),
    defaultValues: { full_name: "", username: "", password: "", kyc_level: "1", transfer_limit: "1000.00" },
  });
  const depositForm = useForm<z.infer<typeof cashSchema>>({
    resolver: zodResolver(cashSchema),
    defaultValues: { account_number: "", amount: "", reference: "" },
  });
  const withdrawForm = useForm<z.infer<typeof cashSchema>>({
    resolver: zodResolver(cashSchema),
    defaultValues: { account_number: "", amount: "", reference: "" },
  });
  const transferForm = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: { from_account: "", to_account: "", amount: "", reference: "" },
  });

  async function load() {
    setLoading(true);
    try {
      const [accs, balList, resBal] = await Promise.all([
        api.accounts(),
        api.accountBalances().catch(() => [] as { account_number: string; balance: string }[]),
        api.bankReserve().catch(() => null),
      ]);
      setAccounts(accs);
      const bs: Record<string, string> = {};
      for (const b of balList) bs[b.account_number] = b.balance;
      setBalances(bs);
      setReserve(resBal);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [bankCode]);

  async function onOnboard(values: z.infer<typeof onboardSchema>) {
    try {
      const acc = await api.onboard({
        full_name: values.full_name,
        username: values.username,
        password: values.password,
        kyc_level: parseInt(values.kyc_level, 10),
        transfer_limit: values.transfer_limit,
      });
      toast.success(`Onboarded ${acc.full_name} (${acc.account_number})`);
      setOnboardOpen(false);
      onboardForm.reset();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Onboarding failed");
    }
  }

  async function onDeposit(values: z.infer<typeof cashSchema>) {
    try {
      await api.deposit({
        account_number: values.account_number,
        amount: values.amount,
        reference: values.reference || "Customer Cash-In Deposit",
      });
      toast.success(`Deposited ${values.amount} SWR to ${values.account_number}`);
      depositForm.reset();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deposit failed");
    }
  }

  async function onWithdraw(values: z.infer<typeof cashSchema>) {
    try {
      await api.withdraw({
        account_number: values.account_number,
        amount: values.amount,
        reference: values.reference || "Customer Cash-Out Withdrawal",
      });
      toast.success(`Withdrew ${values.amount} SWR from ${values.account_number}`);
      withdrawForm.reset();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Withdrawal failed");
    }
  }

  async function onTransfer(values: z.infer<typeof transferSchema>) {
    try {
      await api.transfer({
        from_account: values.from_account,
        to_account: values.to_account,
        amount: values.amount,
        reference: values.reference || "Bank Initiated Transfer",
      });
      toast.success(`Sent ${values.amount} SWR to ${values.to_account}`);
      transferForm.reset();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    }
  }

  async function toggleStatus(acc: Account) {
    const next = acc.status === "active" ? "frozen" : "active";
    try {
      await api.setAccountStatus(acc.account_number, next);
      toast.success(`Account ${acc.account_number} marked ${next}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status update failed");
    }
  }

  const flagged = accounts.filter((a) => a.status === "flagged").length;
  const frozen = accounts.filter((a) => a.status === "frozen").length;

  return (
    <Tabs defaultValue={defaultTab} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          accent
          title="Master Reserve Vault"
          value={reserve ? `रू ${fmtSwr(reserve.balance)}` : null}
          hint="Wholesale CBDC liquidity allocated from the central bank"
          icon={Vault}
        />
        <StatCard
          title="Retail Customers"
          value={accounts.length}
          hint={`${frozen} frozen · ${flagged} AML-flagged`}
          icon={Users}
        />
        <StatCard
          title="AML Watch"
          value={flagged}
          hint={flagged ? "Flagged accounts cannot send payments until cleared" : "No accounts flagged by AML rules"}
          icon={ShieldAlert}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="accounts">Customer accounts</TabsTrigger>
        </TabsList>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Dialog open={onboardOpen} onOpenChange={setOnboardOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><UserPlus className="mr-1.5 h-4 w-4" /> Onboard Customer</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Open New Customer Account</DialogTitle>
                <DialogDescription>
                  Creates the account, customer login, and assigns an Idemix token wallet from the
                  bank's pool. Names are screened against the CB watchlist.
                </DialogDescription>
              </DialogHeader>
              <Form {...onboardForm}>
                <form onSubmit={onboardForm.handleSubmit(onOnboard)} className="space-y-4">
                  <FormField control={onboardForm.control} name="full_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Legal Name</FormLabel>
                      <FormControl><Input placeholder="e.g. Alice Smith" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={onboardForm.control} name="username" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl><Input placeholder="alice" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={onboardForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={onboardForm.control} name="kyc_level" render={({ field }) => (
                      <FormItem>
                        <FormLabel>KYC Tier</FormLabel>
                        <FormControl>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Tier 0 — Unverified (रू 500 / tx)</SelectItem>
                              <SelectItem value="1">Tier 1 — Basic (रू 1,000 / tx)</SelectItem>
                              <SelectItem value="2">Tier 2 — Verified (रू 10,000 / tx)</SelectItem>
                              <SelectItem value="3">Tier 3 — Enhanced (high limits)</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={onboardForm.control} name="transfer_limit" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Transfer Limit (SWR)</FormLabel>
                        <FormControl><Input placeholder="1000.00" inputMode="decimal" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOnboardOpen(false)}>Cancel</Button>
                    <Button type="submit">Complete Onboarding</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <TabsContent value="overview" className="mt-0 space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ArrowDownLeft className="h-5 w-5" /> Cash In (Deposit)
              </CardTitle>
              <CardDescription>
                Disburse CBDC from the bank's Master Reserve Vault into a customer account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...depositForm}>
                <form onSubmit={depositForm.handleSubmit(onDeposit)} className="space-y-4">
                  <FormField control={depositForm.control} name="account_number" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Account</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger><SelectValue placeholder="Select customer account" /></SelectTrigger>
                          <SelectContent>
                            {accounts.map((a) => (
                              <SelectItem key={a.account_number} value={a.account_number}>
                                {a.account_number} — {a.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={depositForm.control} name="amount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount (SWR)</FormLabel>
                        <FormControl><Input placeholder="100.00" inputMode="decimal" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={depositForm.control} name="reference" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reference</FormLabel>
                        <FormControl><Input placeholder="e.g. Teller #1" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <Button type="submit" className="w-full" disabled={depositForm.formState.isSubmitting}>
                    Execute Deposit
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ArrowUpRight className="h-5 w-5" /> Cash Out (Withdraw)
              </CardTitle>
              <CardDescription>
                Redeem customer CBDC back into the bank's reserve — subject to the customer's AML
                daily limits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...withdrawForm}>
                <form onSubmit={withdrawForm.handleSubmit(onWithdraw)} className="space-y-4">
                  <FormField control={withdrawForm.control} name="account_number" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Account</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger><SelectValue placeholder="Select customer account" /></SelectTrigger>
                          <SelectContent>
                            {accounts.map((a) => (
                              <SelectItem key={a.account_number} value={a.account_number}>
                                {a.account_number} — {a.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={withdrawForm.control} name="amount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount (SWR)</FormLabel>
                        <FormControl><Input placeholder="50.00" inputMode="decimal" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={withdrawForm.control} name="reference" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reference</FormLabel>
                        <FormControl><Input placeholder="e.g. ATM Withdrawal" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <Button type="submit" variant="secondary" className="w-full" disabled={withdrawForm.formState.isSubmitting}>
                    Execute Withdrawal
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Send className="h-5 w-5" /> Transfer Funds
            </CardTitle>
            <CardDescription>
              Customer or branch transfers across intra-bank or inter-bank accounts. Inter-bank
              amounts are capped by the bank's permissions; recipients must be registered
              accounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...transferForm}>
              <form onSubmit={transferForm.handleSubmit(onTransfer)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField control={transferForm.control} name="from_account" render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Account</FormLabel>
                    <FormControl><Input placeholder="SWR-001-00000001" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={transferForm.control} name="to_account" render={({ field }) => (
                  <FormItem>
                    <FormLabel>To Account</FormLabel>
                    <FormControl><Input placeholder="SWR-002-00000001" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={transferForm.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (SWR)</FormLabel>
                    <FormControl><Input placeholder="25.00" inputMode="decimal" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex items-end">
                  <Button type="submit" className="w-full" disabled={transferForm.formState.isSubmitting}>
                    <Send className="mr-1.5 h-4 w-4" /> Send Payment
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="accounts" className="mt-0">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Customer Account Registry</CardTitle>
              <CardDescription>
                All accounts managed by Bank {bankCode}, with live on-ledger balances and AML
                status.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!accounts.length}
              onClick={() =>
                downloadCsv(
                  `accounts-${bankCode}.csv`,
                  accounts.map((a) => ({
                    account_number: a.account_number, full_name: a.full_name,
                    status: a.status, kyc_level: a.kyc_level,
                    transfer_limit: a.transfer_limit, balance: balances[a.account_number] ?? "",
                  })),
                )
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>KYC Tier</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Per-tx limit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.account_number}>
                    <TableCell className="font-mono text-sm font-semibold">{a.account_number}</TableCell>
                    <TableCell className="font-medium">{a.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {KYC_LABELS[String(a.kyc_level)] ?? `Tier ${a.kyc_level}`}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-bold tabular-nums">
                      {balances[a.account_number] === "" ? (
                        <span className="text-xs text-muted-foreground">unreachable</span>
                      ) : (
                        `रू ${balances[a.account_number] ? fmtSwr(balances[a.account_number]) : "…"}`
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      रू {fmtSwr(a.transfer_limit)}
                    </TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={a.status === "active" ? "ghost" : "outline"}
                        size="sm"
                        onClick={() => toggleStatus(a)}
                      >
                        {a.status === "active" ? "Freeze" : "Unfreeze"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!accounts.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      No customer accounts yet. Click "Onboard Customer" to open one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
