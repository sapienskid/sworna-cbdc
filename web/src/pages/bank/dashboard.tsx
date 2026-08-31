import * as React from "react";
import { UserPlus, Send, ArrowDownLeft, ArrowUpRight, Vault, Users, ShieldCheck, RefreshCcw } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Account, type Balance } from "@/lib/api";
import { toast } from "sonner";

const onboardSchema = z.object({
  full_name: z.string().min(1, "Full name required"),
  username: z.string().min(3, "Username min 3 characters"),
  password: z.string().min(6, "Password min 6 characters"),
  kyc_level: z.string().min(1, "KYC level required"),
  transfer_limit: z.string().min(1, "Limit required"),
});

const depositSchema = z.object({
  account_number: z.string().min(1, "Select customer account"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

const withdrawSchema = z.object({
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

export function BankDashboard({ bankCode }: { bankCode: string }) {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [balances, setBalances] = React.useState<Record<string, string>>({});
  const [reserve, setReserve] = React.useState<Balance | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [onboardOpen, setOnboardOpen] = React.useState(false);
  const [depositOpen, setDepositOpen] = React.useState(false);
  const [withdrawOpen, setWithdrawOpen] = React.useState(false);

  const onboardForm = useForm<z.infer<typeof onboardSchema>>({
    resolver: zodResolver(onboardSchema),
    defaultValues: { full_name: "", username: "", password: "", kyc_level: "1", transfer_limit: "1000.00" },
  });

  const depositForm = useForm<z.infer<typeof depositSchema>>({
    resolver: zodResolver(depositSchema),
    defaultValues: { account_number: "", amount: "", reference: "" },
  });

  const withdrawForm = useForm<z.infer<typeof withdrawSchema>>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: { account_number: "", amount: "", reference: "" },
  });

  const transferForm = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: { from_account: "", to_account: "", amount: "", reference: "" },
  });

  async function load() {
    setLoading(true);
    try {
      const [accs, resBal] = await Promise.all([
        api.accounts(),
        api.bankReserve().catch(() => null),
      ]);
      setAccounts(accs);
      setReserve(resBal);

      const bs: Record<string, string> = {};
      for (const a of accs) {
        try {
          bs[a.account_number] = (await api.balance(a.account_number)).balance;
        } catch {
          bs[a.account_number] = "—";
        }
      }
      setBalances(bs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
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
      toast.success(`Onboarded customer ${acc.full_name} (${acc.account_number})`);
      setOnboardOpen(false);
      onboardForm.reset();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Onboarding failed");
    }
  }

  async function onDeposit(values: z.infer<typeof depositSchema>) {
    try {
      await api.deposit({
        account_number: values.account_number,
        amount: values.amount,
        reference: values.reference || "Customer Cash-In Deposit",
      });
      toast.success(`Deposited ${values.amount} SWR to ${values.account_number}`);
      setDepositOpen(false);
      depositForm.reset();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deposit failed");
    }
  }

  async function onWithdraw(values: z.infer<typeof withdrawSchema>) {
    try {
      await api.withdraw({
        account_number: values.account_number,
        amount: values.amount,
        reference: values.reference || "Customer Cash-Out Withdrawal",
      });
      toast.success(`Withdrew ${values.amount} SWR from ${values.account_number}`);
      setWithdrawOpen(false);
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
      toast.success(`Sent ${values.amount} SWR from ${values.from_account} to ${values.to_account}`);
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

  return (
    <div className="space-y-6">
      {/* Top Bank Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bank Master Reserve Vault</CardTitle>
            <Vault className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-extrabold text-foreground">
              रू {reserve ? Number(reserve.balance).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "…"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Wholesale CBDC liquidity allocated from Central Bank</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Retail Customers</CardTitle>
            <Users className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-extrabold">{accounts.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Active customer accounts at Bank {bankCode}</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Core Banking Actions</CardTitle>
            <ShieldCheck className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Header with Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Customer Accounts & Liquidity</h2>
          <p className="text-sm text-muted-foreground">Manage customer KYC onboarding, cash-in deposits, and cash-out withdrawals.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Onboard Customer Dialog */}
          <Dialog open={onboardOpen} onOpenChange={setOnboardOpen}>
            <DialogTrigger asChild>
              <Button><UserPlus className="mr-1.5 h-4 w-4" /> Onboard Customer</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Open New Customer Account</DialogTitle>
                <DialogDescription>Dynamically creates an account, customer login, and assigns an on-demand Idemix token wallet.</DialogDescription>
              </DialogHeader>
              <Form {...onboardForm}>
                <form onSubmit={onboardForm.handleSubmit(onOnboard)} className="space-y-4">
                  <FormField
                    control={onboardForm.control}
                    name="full_name"
                    render={({ field }) => (
                      <FormItem><FormLabel>Full Legal Name</FormLabel><FormControl><Input placeholder="e.g. Alice Smith" {...field} /></FormControl><FormMessage /></FormItem>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={onboardForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem><FormLabel>Username</FormLabel><FormControl><Input placeholder="alice" {...field} /></FormControl><FormMessage /></FormItem>
                      )}
                    />
                    <FormField
                      control={onboardForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>
                      )}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={onboardForm.control}
                      name="kyc_level"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>KYC Tier Level</FormLabel>
                          <FormControl>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">Tier 1 — Basic (रू 1,000 limit)</SelectItem>
                                <SelectItem value="2">Tier 2 — Verified (रू 10,000 limit)</SelectItem>
                                <SelectItem value="3">Tier 3 — Enhanced (Unlimited)</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={onboardForm.control}
                      name="transfer_limit"
                      render={({ field }) => (
                        <FormItem><FormLabel>Transfer Limit (SWR)</FormLabel><FormControl><Input placeholder="1000.00" {...field} /></FormControl><FormMessage /></FormItem>
                      )}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOnboardOpen(false)}>Cancel</Button>
                    <Button type="submit">Complete Onboarding</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          {/* Cash In / Deposit Dialog */}
          <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><ArrowDownLeft className="mr-1.5 h-4 w-4 text-green-600" /> Cash In (Deposit)</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Customer Cash-In (Deposit CBDC)</DialogTitle>
                <DialogDescription>Converts customer cash deposit into digital currency disbursed from Bank Reserve.</DialogDescription>
              </DialogHeader>
              <Form {...depositForm}>
                <form onSubmit={depositForm.handleSubmit(onDeposit)} className="space-y-4">
                  <FormField
                    control={depositForm.control}
                    name="account_number"
                    render={({ field }) => (
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
                    )}
                  />
                  <FormField
                    control={depositForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem><FormLabel>Deposit Amount (SWR)</FormLabel><FormControl><Input placeholder="100.00" {...field} /></FormControl><FormMessage /></FormItem>
                    )}
                  />
                  <FormField
                    control={depositForm.control}
                    name="reference"
                    render={({ field }) => (
                      <FormItem><FormLabel>Reference</FormLabel><FormControl><Input placeholder="e.g. Cash Deposit Teller #1" {...field} /></FormControl></FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDepositOpen(false)}>Cancel</Button>
                    <Button type="submit">Execute Deposit</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          {/* Cash Out / Withdraw Dialog */}
          <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><ArrowUpRight className="mr-1.5 h-4 w-4 text-orange-600" /> Cash Out (Withdraw)</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Customer Cash-Out (Redeem CBDC)</DialogTitle>
                <DialogDescription>Customer redeems CBDC for cash, returning digital currency to the Bank Reserve.</DialogDescription>
              </DialogHeader>
              <Form {...withdrawForm}>
                <form onSubmit={withdrawForm.handleSubmit(onWithdraw)} className="space-y-4">
                  <FormField
                    control={withdrawForm.control}
                    name="account_number"
                    render={({ field }) => (
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
                    )}
                  />
                  <FormField
                    control={withdrawForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem><FormLabel>Withdrawal Amount (SWR)</FormLabel><FormControl><Input placeholder="50.00" {...field} /></FormControl><FormMessage /></FormItem>
                    )}
                  />
                  <FormField
                    control={withdrawForm.control}
                    name="reference"
                    render={({ field }) => (
                      <FormItem><FormLabel>Reference</FormLabel><FormControl><Input placeholder="e.g. ATM Withdrawal" {...field} /></FormControl></FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setWithdrawOpen(false)}>Cancel</Button>
                    <Button type="submit">Execute Withdrawal</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Customer Accounts Table */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Customer Account Registry</CardTitle>
          <CardDescription>All retail and business accounts managed by Bank {bankCode}.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Number</TableHead>
                <TableHead>Customer Name</TableHead>
                <TableHead>KYC Tier</TableHead>
                <TableHead>Balance</TableHead>
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
                      Tier {a.kyc_level}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-bold text-foreground">
                    रू {balances[a.account_number] ? Number(balances[a.account_number]).toFixed(2) : "…"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.status === "active" ? "default" : "destructive"}>
                      {a.status}
                    </Badge>
                  </TableCell>
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
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                    No customer accounts registered yet. Click "Onboard Customer" above to open an account.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Interbank & Core Settlement Console */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" /> Transfer Funds
          </CardTitle>
          <CardDescription>Execute customer or branch transfers across intra-bank or inter-bank accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...transferForm}>
            <form onSubmit={transferForm.handleSubmit(onTransfer)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField
                control={transferForm.control}
                name="from_account"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Account</FormLabel>
                    <FormControl><Input placeholder="SWR-001-00000001" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={transferForm.control}
                name="to_account"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>To Account</FormLabel>
                    <FormControl><Input placeholder="SWR-002-00000001" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={transferForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (SWR)</FormLabel>
                    <FormControl><Input placeholder="25.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-end">
                <Button type="submit" className="w-full" disabled={transferForm.formState.isSubmitting}>
                  <Send className="mr-1.5 h-4 w-4" /> Send Payment
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}