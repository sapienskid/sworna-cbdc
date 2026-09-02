import * as React from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { QRCodeSVG } from "qrcode.react";
import {
  Send, Copy, Check, RefreshCcw, Wallet, ArrowUpRight, ArrowDownLeft, Download,
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
import { downloadCsv, fmtSwr } from "@/lib/format";
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
      const [b, s] = await Promise.all([api.balance(account), api.statements(account)]);
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
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
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
      toast.success(`Redeemed ${values.amount} SWR for cash`);
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
      {/* Wallet card */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-background to-muted shadow-md">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-primary/10 font-semibold">
                  Digital Rupee (CBDC)
                </Badge>
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Wallet className="h-3 w-3" /> Idemix wallet
                </Badge>
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Available Balance
              </p>
              <p className="text-4xl font-extrabold tabular-nums tracking-tight">
                रू {balance ? fmtSwr(balance.balance) : "…"}
              </p>
            </div>

            <div className="text-right">
              <p className="font-semibold">{balance?.full_name || user?.username}</p>
              <p className="text-xs text-muted-foreground">Bank {balance?.bank_code ?? user?.bank_code}</p>
              <div className="mt-3 flex items-center justify-end gap-1.5">
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs font-medium">{account}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyAccount}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={loading}>
                  <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="send" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="send" className="flex items-center gap-1.5">
            <Send className="h-4 w-4" /> Send
          </TabsTrigger>
          <TabsTrigger value="receive" className="flex items-center gap-1.5">
            <Wallet className="h-4 w-4" /> Receive
          </TabsTrigger>
          <TabsTrigger value="cashout" className="flex items-center gap-1.5">
            <ArrowUpRight className="h-4 w-4" /> Cash Out
          </TabsTrigger>
        </TabsList>

        <TabsContent value="send">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Send className="h-5 w-5" /> Instant CBDC Transfer
              </CardTitle>
              <CardDescription>
                Settle directly to any registered account, same bank or inter-bank. Payments are
                subject to your KYC tier's per-transaction and daily limits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...sendForm}>
                <form onSubmit={sendForm.handleSubmit(onSend)} className="space-y-4">
                  <FormField control={sendForm.control} name="to_account" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipient Account Number</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. SWR-001-00000002" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={sendForm.control} name="amount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount (SWR)</FormLabel>
                        <FormControl><Input placeholder="10.00" inputMode="decimal" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={sendForm.control} name="reference" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Note / Memo</FormLabel>
                        <FormControl><Input placeholder="e.g. Lunch split" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <Button type="submit" className="w-full" disabled={sendForm.formState.isSubmitting}>
                    <Send className="mr-1.5 h-4 w-4" /> Send Payment
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receive">
          <Card className="shadow-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-lg">Receive Digital Rupee</CardTitle>
              <CardDescription>
                Let the sender scan your account QR or share your account number.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center space-y-4 py-4">
              <div className="rounded-2xl border bg-white p-4 shadow-inner">
                <QRCodeSVG
                  value={JSON.stringify({ v: 1, network: "sworna", account })}
                  size={176}
                  level="M"
                />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{balance?.full_name}</p>
                <code className="font-mono text-sm font-bold">{account}</code>
              </div>
              <Button variant="outline" onClick={copyAccount} className="flex items-center gap-1.5">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copy Account Number
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cashout">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ArrowUpRight className="h-5 w-5" /> Cash-Out (Redeem for Physical Cash)
              </CardTitle>
              <CardDescription>
                Redeem digital currency for cash at any bank teller or ATM. Daily limits apply.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...withdrawForm}>
                <form onSubmit={withdrawForm.handleSubmit(onWithdraw)} className="space-y-4">
                  <FormField control={withdrawForm.control} name="amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Redemption Amount (SWR)</FormLabel>
                      <FormControl><Input placeholder="50.00" inputMode="decimal" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={withdrawForm.control} name="reference" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Withdrawal Purpose</FormLabel>
                      <FormControl><Input placeholder="e.g. Branch counter cash out" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <Button type="submit" variant="secondary" className="w-full" disabled={withdrawForm.formState.isSubmitting}>
                    Execute Cash-Out
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-5 w-5 text-muted-foreground" /> Statement History
            </CardTitle>
            <CardDescription>Transaction receipts as recorded by the auditor node.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!statements.length}
              onClick={() =>
                downloadCsv(
                  "statement.csv",
                  statements.map((s) => ({
                    txid: s.txid, sender: s.sender, recipient: s.recipient,
                    amount: (s.amount / 100).toFixed(2), reference: s.reference,
                    status: s.status, timestamp: s.timestamp,
                  })),
                )
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tx ID</TableHead>
                <TableHead>Direction</TableHead>
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
                      {isIncoming ? (
                        <span className="flex items-center text-xs font-semibold">
                          <ArrowDownLeft className="mr-0.5 h-3.5 w-3.5" /> From {s.sender || "Central Bank"}
                        </span>
                      ) : (
                        <span className="flex items-center text-xs font-semibold">
                          <ArrowUpRight className="mr-0.5 h-3.5 w-3.5 text-muted-foreground" /> To{" "}
                          {s.recipient || "Counterparty"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={`font-bold tabular-nums ${isIncoming ? "" : "text-muted-foreground"}`}>
                      {isIncoming ? "+" : "-"}
                      {fmtSwr(s.amount / 100)} SWR
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.reference || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {s.status || "Settled"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!statements.length && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
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
