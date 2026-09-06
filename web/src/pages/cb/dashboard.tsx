import * as React from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Coins,
  Flame,
  Landmark,
  RefreshCcw,
  ArrowRightLeft,
  ShieldCheck,
  PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard, BarList } from "@/components/kit";
import { api, type CryptoParams, type Overview, type Bank } from "@/lib/api";
import { fmtInt, fmtSwr } from "@/lib/format";
import { toast } from "sonner";

const mintSchema = z.object({
  bank_code: z.string().min(1, "Select target commercial bank"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

const allocateSchema = z.object({
  from_bank_code: z.string().min(1, "Source bank required"),
  to_bank_code: z.string().min(1, "Destination bank required"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

const burnSchema = z.object({
  bank_code: z.string().min(1, "Select bank"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

function CryptoBadge({ params }: { params: CryptoParams | null }) {
  if (!params)
    return (
      <div className="space-y-2 pt-1">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-44" />
      </div>
    );
  return (
    <div className="pt-1 space-y-1">
      <div className="flex items-center gap-1.5">
        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium text-xs">
          <ShieldCheck className="mr-1 h-3 w-3" /> Zero-Knowledge Settlement Active
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Token Layer: <span className="font-semibold text-foreground">{params.identifier.toUpperCase()}</span> · Privacy Preserved
      </p>
      <p className="text-[11px] text-muted-foreground">
        Pedersen Blinded · Regulatory Auditor Verified
      </p>
    </div>
  );
}

export function CBDashboard() {
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [banks, setBanks] = React.useState<Bank[]>([]);
  const [crypto, setCrypto] = React.useState<CryptoParams | null>(null);
  const [burnConfirmOpen, setBurnConfirmOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const mintForm = useForm<z.infer<typeof mintSchema>>({
    resolver: zodResolver(mintSchema),
    defaultValues: { bank_code: "", amount: "", reference: "" },
  });
  const allocateForm = useForm<z.infer<typeof allocateSchema>>({
    resolver: zodResolver(allocateSchema),
    defaultValues: { from_bank_code: "", to_bank_code: "", amount: "", reference: "" },
  });
  const burnForm = useForm<z.infer<typeof burnSchema>>({
    resolver: zodResolver(burnSchema),
    defaultValues: { bank_code: "", amount: "", reference: "" },
  });

  async function load() {
    setLoading(true);
    try {
      const [ov, bList, cr] = await Promise.all([
        api.overview(),
        api.banks(),
        api.cryptoParams().catch(() => null),
      ]);
      setOverview(ov);
      setBanks(bList);
      setCrypto(cr);
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
  }, []);

  async function onMint(values: z.infer<typeof mintSchema>) {
    try {
      await api.mint({
        bank_code: values.bank_code,
        amount: values.amount,
        reference: values.reference || "Wholesale Reserve Mint",
      });
      toast.success(`Minted ${values.amount} SWR to Bank ${values.bank_code} reserve`);
      mintForm.reset({ bank_code: "", amount: "", reference: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Minting failed");
    }
  }

  async function onAllocate(values: z.infer<typeof allocateSchema>) {
    if (values.from_bank_code === values.to_bank_code) {
      toast.error("Source and destination banks must be different");
      return;
    }
    try {
      await api.allocate({
        from_bank_code: values.from_bank_code,
        to_bank_code: values.to_bank_code,
        amount: values.amount,
        reference: values.reference || "Wholesale Interbank Liquidity Transfer",
      });
      toast.success(`Allocated ${values.amount} SWR from Bank ${values.from_bank_code} to Bank ${values.to_bank_code}`);
      allocateForm.reset({ from_bank_code: "", to_bank_code: "", amount: "", reference: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Allocation failed");
    }
  }

  async function onBurn(values: z.infer<typeof burnSchema>) {
    setBurnConfirmOpen(false);
    try {
      await api.burn({
        bank_code: values.bank_code,
        amount: values.amount,
        reference: values.reference || "Wholesale CBDC Revocation / Burn",
      });
      toast.success(`Burned ${values.amount} SWR from Bank ${values.bank_code} reserve`);
      burnForm.reset({ bank_code: "", amount: "", reference: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Burn failed");
    }
  }

  const reserveRows = (overview?.circulation ?? []).map((r) => ({
    label: `${r.bank_name} (${r.bank_code})`,
    value: Number(r.total),
    sub: `${r.account_count} customer accounts · status ${r.status}`,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          accent
          title="Total M0 CBDC in Circulation"
          value={overview ? `रू ${fmtSwr(overview.total_supply)}` : null}
          hint="Backing central bank digital currency supply"
          icon={Coins}
        />
        <StatCard
          title="Registered Commercial Banks"
          value={overview ? fmtInt(overview.circulation.length) : null}
          hint="Directly connected settlement participants"
          icon={Landmark}
        />
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Privacy & Cryptography</CardTitle>
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent className="flex items-start justify-between gap-2">
            <CryptoBadge params={crypto} />
            <Button variant="outline" size="sm" onClick={load} disabled={loading} title="Refresh Cryptography State">
              <RefreshCcw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </CardContent>
        </Card>
      </div>

      {overview && overview.wallets_unreachable > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 shadow-sm">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-amber-700 dark:text-amber-400">
            <RefreshCcw className="h-4 w-4 animate-spin text-amber-600" />
            <span>
              {overview.wallets_unreachable} commercial bank node(s) currently synchronizing. Ledger supply updates automatically once nodes connect.
            </span>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="mint" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:w-[600px]">
          <TabsTrigger value="mint" className="flex items-center gap-1">
            <PlusCircle className="h-4 w-4" /> Mint & Issue
          </TabsTrigger>
          <TabsTrigger value="allocate" className="flex items-center gap-1">
            <ArrowRightLeft className="h-4 w-4" /> Allocate
          </TabsTrigger>
          <TabsTrigger value="burn" className="flex items-center gap-1">
            <Flame className="h-4 w-4" /> Revoke / Burn
          </TabsTrigger>
          <TabsTrigger value="reserves" className="flex items-center gap-1">
            <Landmark className="h-4 w-4" /> Reserves
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mint">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Coins className="h-5 w-5" /> Mint Wholesale CBDC to Bank
                </CardTitle>
                <CardDescription>
                  Issue new central bank digital currency (M0) directly into a commercial bank's
                  Master Reserve Vault.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...mintForm}>
                  <form onSubmit={mintForm.handleSubmit(onMint)} className="space-y-4">
                    <FormField
                      control={mintForm.control}
                      name="bank_code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Target Commercial Bank</FormLabel>
                          <FormControl>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select commercial bank" />
                              </SelectTrigger>
                              <SelectContent>
                                {banks.map((b) => (
                                  <SelectItem key={b.code} value={b.code}>
                                    Bank {b.code} — {b.name} ({b.status})
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
                      control={mintForm.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issuance Amount (SWR)</FormLabel>
                          <FormControl>
                            <Input placeholder="5000.00" inputMode="decimal" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={mintForm.control}
                      name="reference"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Collateral / Treasury Reference</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Treasury Bond #TB-2026-99" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={mintForm.formState.isSubmitting}>
                      Mint Wholesale SWR to Bank Reserve
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Commercial Bank Reserves</CardTitle>
                <CardDescription>
                  Wholesale digital currency held across commercial banks.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BarList rows={reserveRows} formatter={(v) => `रू ${fmtSwr(v)}`} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="allocate">
          <Card className="max-w-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ArrowRightLeft className="h-5 w-5" /> Wholesale Interbank Liquidity Allocation
              </CardTitle>
              <CardDescription>
                Transfer wholesale digital currency between commercial bank reserves for liquidity
                balancing or settlement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...allocateForm}>
                <form onSubmit={allocateForm.handleSubmit(onAllocate)} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={allocateForm.control}
                      name="from_bank_code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Source Bank (Debited)</FormLabel>
                          <FormControl>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select source bank" />
                              </SelectTrigger>
                              <SelectContent>
                                {banks.map((b) => (
                                  <SelectItem key={b.code} value={b.code}>
                                    Bank {b.code} ({b.name})
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
                      control={allocateForm.control}
                      name="to_bank_code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Destination Bank (Credited)</FormLabel>
                          <FormControl>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select destination bank" />
                              </SelectTrigger>
                              <SelectContent>
                                {banks.map((b) => (
                                  <SelectItem key={b.code} value={b.code}>
                                    Bank {b.code} ({b.name})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={allocateForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount (SWR)</FormLabel>
                        <FormControl>
                          <Input placeholder="1000.00" inputMode="decimal" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={allocateForm.control}
                    name="reference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Settlement Reference</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. End-of-Day RTGS Settlement" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={allocateForm.formState.isSubmitting}>
                    Execute Wholesale Allocation
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="burn">
          <Card className="max-w-2xl border-destructive/30 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg text-destructive">
                <Flame className="h-5 w-5" /> Revoke / Burn CBDC from Bank
              </CardTitle>
              <CardDescription>
                Retire digital currency from a commercial bank's reserve back into the central bank
                vault, reducing total M0 supply. This operation is final once confirmed on the
                ledger.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...burnForm}>
                <form
                  onSubmit={burnForm.handleSubmit(() => setBurnConfirmOpen(true))}
                  className="space-y-4"
                >
                  <FormField
                    control={burnForm.control}
                    name="bank_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Commercial Bank</FormLabel>
                        <FormControl>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select bank" />
                            </SelectTrigger>
                            <SelectContent>
                              {banks.map((b) => (
                                <SelectItem key={b.code} value={b.code}>
                                  Bank {b.code} — {b.name}
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
                    control={burnForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount to Burn (SWR)</FormLabel>
                        <FormControl>
                          <Input placeholder="500.00" inputMode="decimal" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={burnForm.control}
                    name="reference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Burn Authorization / Reference</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Surplus Liquidity Withdrawal" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button type="submit" variant="destructive" className="w-full" disabled={burnForm.formState.isSubmitting}>
                    Burn CBDC Tokens
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Dialog open={burnConfirmOpen} onOpenChange={setBurnConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm irreversible burn</DialogTitle>
                <DialogDescription>
                  This destroys {burnForm.getValues("amount") || "0"} SWR from Bank{" "}
                  {burnForm.getValues("bank_code") || "—"}'s reserve permanently. The tokens are
                  redeemed on the ledger and can never be re-issued.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBurnConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={burnForm.handleSubmit(onBurn)}>
                  Yes, burn tokens
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="reserves">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Reserve Distribution</CardTitle>
              <CardDescription>
                Circulation per commercial bank, from live on-ledger wallet balances.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bank</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Accounts</TableHead>
                    <TableHead className="text-right">Circulation (SWR)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(overview?.circulation ?? []).map((r) => (
                    <TableRow key={r.bank_code}>
                      <TableCell className="font-medium">
                        {r.bank_name}{" "}
                        <span className="font-mono text-xs text-muted-foreground">{r.bank_code}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "active" ? "secondary" : "outline"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.account_count}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        रू {fmtSwr(r.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!overview?.circulation.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        No commercial banks registered.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
