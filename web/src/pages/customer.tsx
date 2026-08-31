import * as React from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Send,
  QrCode,
  Copy,
  Check,
  RefreshCcw,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Balance, type StatementItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const sendSchema = z.object({
  to_account: z.string().min(1, "Recipient account required"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

const withdrawSchema = z.object({
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

export function CustomerView() {
  const { user } = useAuth();
  const account = user?.account_number ?? "";
  const [balance, setBalance] = React.useState<Balance | null>(null);
  const [statements, setStatements] = React.useState<StatementItem[]>([]);
  const [copied, setCopied] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const sendForm = useForm<z.infer<typeof sendSchema>>({
    resolver: zodResolver(sendSchema),
    defaultValues: { to_account: "", amount: "", reference: "" },
  });

  const withdrawForm = useForm<z.infer<typeof withdrawSchema>>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: { amount: "", reference: "" },
  });

  async function load() {
    if (!account) return;
    setLoading(true);
    try {
      const [b, s] = await Promise.all([
        api.balance(account),
        api.statements(account),
      ]);
      setBalance(b);
      setStatements(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [account]);

  async function onSend(values: z.infer<typeof sendSchema>) {
    try {
      await api.transfer({ from_account: account, ...values });
      toast.success(`Transferred ${values.amount} SWR to ${values.to_account}`);
      sendForm.reset({ to_account: "", amount: "", reference: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    }
  }

  async function onWithdraw(values: z.infer<typeof withdrawSchema>) {
    try {
      await api.withdraw({
        account_number: account,
        amount: values.amount,
        reference: values.reference || "Retail Cash Withdrawal",
      });
      toast.success(`Successfully redeemed ${values.amount} SWR for cash`);
      withdrawForm.reset({ amount: "", reference: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Withdrawal failed");
    }
  }

  function copyAccount() {
    navigator.clipboard.writeText(account);
    setCopied(true);
    toast.info("Account number copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Citizen Wallet Card */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-background to-muted shadow-md">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-primary/20 text-primary font-semibold border-primary/30">
                  Digital Rupee (CBDC)
                </Badge>
                <Badge variant="secondary" className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-green-600" /> ZK-Encrypted
                </Badge>
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Available Balance</p>
              <p className="text-4xl font-extrabold tracking-tight text-foreground">
                रू {balance ? Number(balance.balance).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "…"}
              </p>
            </div>

            <div className="text-right">
              <p className="font-semibold text-foreground">{balance?.full_name || user?.username}</p>
              <p className="text-xs text-muted-foreground">Bank {balance?.bank_code ?? user?.bank_code}</p>
              <div className="mt-3 flex items-center justify-end gap-1.5">
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground">
                  {account}
                </code>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyAccount}>
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={loading}>
                  <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="send" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="send" className="flex items-center gap-1.5">
            <Send className="h-4 w-4" /> Send Payment
          </TabsTrigger>
          <TabsTrigger value="receive" className="flex items-center gap-1.5">
            <QrCode className="h-4 w-4" /> Receive / QR
          </TabsTrigger>
          <TabsTrigger value="cashout" className="flex items-center gap-1.5">
            <ArrowUpRight className="h-4 w-4 text-orange-600" /> Cash Out
          </TabsTrigger>
        </TabsList>

        {/* Tab: Send Money */}
        <TabsContent value="send">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Send className="h-5 w-5 text-primary" /> Instant CBDC Transfer
              </CardTitle>
              <CardDescription>
                Transfer funds directly to any account (same bank or inter-bank across Nepal) with zero-knowledge privacy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...sendForm}>
                <form onSubmit={sendForm.handleSubmit(onSend)} className="space-y-4">
                  <FormField
                    control={sendForm.control}
                    name="to_account"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recipient Account Number</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. SWR-001-00000002 or SWR-002-00000001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={sendForm.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount (SWR)</FormLabel>
                          <FormControl><Input placeholder="10.00" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sendForm.control}
                      name="reference"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payment Note / Memo</FormLabel>
                          <FormControl><Input placeholder="e.g. Lunch split, Grocery" {...field} /></FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={sendForm.formState.isSubmitting}>
                    <Send className="mr-1.5 h-4 w-4" /> Send Payment
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Receive / QR */}
        <TabsContent value="receive">
          <Card className="shadow-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-lg">Receive Digital Rupee</CardTitle>
              <CardDescription>Share your account details or scan QR code to receive payments instantly.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center space-y-4 py-4">
              <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-muted/30 p-4 shadow-inner">
                <QrCode className="h-32 w-32 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{balance?.full_name}</p>
                <code className="font-mono text-sm font-bold text-primary">{account}</code>
              </div>
              <Button variant="outline" onClick={copyAccount} className="flex items-center gap-1.5">
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                Copy Account Number
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Cash Out */}
        <TabsContent value="cashout">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-orange-600" /> Cash-Out (Redeem for Physical Cash)
              </CardTitle>
              <CardDescription>
                Redeem your digital currency tokens back for fiat currency at any bank teller or ATM.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...withdrawForm}>
                <form onSubmit={withdrawForm.handleSubmit(onWithdraw)} className="space-y-4">
                  <FormField
                    control={withdrawForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Redemption Amount (SWR)</FormLabel>
                        <FormControl><Input placeholder="50.00" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={withdrawForm.control}
                    name="reference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Withdrawal Purpose</FormLabel>
                        <FormControl><Input placeholder="e.g. Branch Counter Cash Out" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <Button type="submit" variant="secondary" className="w-full" disabled={withdrawForm.formState.isSubmitting}>
                    Execute Cash-Out
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Statements Table */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5 text-muted-foreground" /> Statement History
            </CardTitle>
            <CardDescription>Zero-knowledge transaction receipts audited on the token ledger.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tx ID</TableHead>
                <TableHead>Type & Direction</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.slice(0, 25).map((s, i) => {
                const isIncoming = s.recipient === account || s.recipient === balance?.full_name;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {s.txid ? `${s.txid.slice(0, 10)}…` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {isIncoming ? (
                          <span className="flex items-center text-xs font-semibold text-green-600">
                            <ArrowDownLeft className="h-3.5 w-3.5 mr-0.5" /> From {s.sender || "Central Bank"}
                          </span>
                        ) : (
                          <span className="flex items-center text-xs font-semibold text-foreground">
                            <ArrowUpRight className="h-3.5 w-3.5 mr-0.5 text-muted-foreground" /> To {s.recipient || "Counterparty"}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={`font-bold ${isIncoming ? "text-green-600" : "text-foreground"}`}>
                      {isIncoming ? "+" : "-"}{(s.amount / 100).toFixed(2)} SWR
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.reference || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
                        {s.status || "Settled"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!statements.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                    No transactions recorded on this account yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}