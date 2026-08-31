import * as React from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Coins,
  Landmark,
  RefreshCcw,
  Flame,
  ArrowRightLeft,
  ShieldCheck,
  UserPlus,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Overview, type Bank, type UserRead } from "@/lib/api";
import { toast } from "sonner";

// Mint Schema (Wholesale Issuance to Commercial Bank)
const mintSchema = z.object({
  bank_code: z.string().min(1, "Select target commercial bank"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

// Allocation Schema (Wholesale transfer between banks)
const allocateSchema = z.object({
  from_bank_code: z.string().min(1, "Source bank required"),
  to_bank_code: z.string().min(1, "Destination bank required"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

// Burn Schema (Redeem/retire from bank reserve)
const burnSchema = z.object({
  bank_code: z.string().min(1, "Select bank"),
  amount: z.string().min(1, "Amount required"),
  reference: z.string(),
});

// CB Staff Schema
const cbStaffSchema = z.object({
  username: z.string().min(3, "Min 3 characters"),
  password: z.string().min(6, "Min 6 characters"),
  role: z.enum(["cb_admin", "cb_mint_officer", "cb_auditor"]),
  full_name: z.string(),
});

export function CBDashboard() {
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [banks, setBanks] = React.useState<Bank[]>([]);
  const [cbStaff, setCbStaff] = React.useState<UserRead[]>([]);
  const [userModalOpen, setUserModalOpen] = React.useState(false);
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

  const staffForm = useForm<z.infer<typeof cbStaffSchema>>({
    resolver: zodResolver(cbStaffSchema),
    defaultValues: { username: "", password: "", role: "cb_mint_officer", full_name: "" },
  });

  async function load() {
    setLoading(true);
    try {
      const [ov, bList, staffList] = await Promise.all([
        api.overview(),
        api.banks(),
        api.cbUsers().catch(() => []),
      ]);
      setOverview(ov);
      setBanks(bList);
      setCbStaff(staffList);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function onMint(values: z.infer<typeof mintSchema>) {
    try {
      await api.mint({
        bank_code: values.bank_code,
        amount: values.amount,
        reference: values.reference || "Wholesale Reserve Mint",
      });
      toast.success(`Successfully minted ${values.amount} SWR to Bank ${values.bank_code} Reserve`);
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
    try {
      await api.burn({
        bank_code: values.bank_code,
        amount: values.amount,
        reference: values.reference || "Wholesale CBDC Revocation / Burn",
      });
      toast.success(`Burned/Revoked ${values.amount} SWR from Bank ${values.bank_code} Reserve`);
      burnForm.reset({ bank_code: "", amount: "", reference: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Burn failed");
    }
  }

  async function onCreateStaff(values: z.infer<typeof cbStaffSchema>) {
    try {
      await api.createCbUser(values);
      toast.success(`Central Bank staff ${values.username} created`);
      setUserModalOpen(false);
      staffForm.reset();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Staff creation failed");
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total M0 CBDC in Circulation</CardTitle>
            <Coins className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-extrabold text-foreground">
              रू {overview ? Number(overview.total_supply).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "…"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Backing Central Bank digital currency supply</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Registered Commercial Banks</CardTitle>
            <Landmark className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-extrabold">{overview?.circulation.length ?? "…"}</p>
            <p className="text-xs text-muted-foreground mt-1">Directly connected settlement participants</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Blockchain Network</CardTitle>
            <ShieldCheck className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent className="flex items-center justify-between pt-1">
            <div>
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                ZK-UTXO Active
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">Camenisch-Lysyanskaya / Pedersen</p>
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Main Operations Tabs */}
      <Tabs defaultValue="mint" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:w-[600px]">
          <TabsTrigger value="mint" className="flex items-center gap-1">
            <PlusCircle className="h-4 w-4" /> Mint & Issue
          </TabsTrigger>
          <TabsTrigger value="allocate" className="flex items-center gap-1">
            <ArrowRightLeft className="h-4 w-4" /> Allocate
          </TabsTrigger>
          <TabsTrigger value="burn" className="flex items-center gap-1">
            <Flame className="h-4 w-4 text-destructive" /> Revoke / Burn
          </TabsTrigger>
          <TabsTrigger value="staff" className="flex items-center gap-1">
            <UserPlus className="h-4 w-4" /> Access (RBAC)
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Mint to Commercial Bank */}
        <TabsContent value="mint">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Coins className="h-5 w-5 text-primary" /> Mint Wholesale CBDC to Bank
                </CardTitle>
                <CardDescription>
                  Issue new central bank digital currency ($M_0$) directly into a commercial bank's Master Reserve Vault.
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
                            <Input placeholder="5000.00" {...field} />
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

            {/* Bank Reserves Status */}
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Commercial Bank Reserves</CardTitle>
                <CardDescription>Real-time digital currency reserves held across commercial banks.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {overview?.circulation.map((row) => (
                  <div key={row.bank_code} className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors">
                    <div>
                      <p className="font-semibold text-foreground">
                        {row.bank_name} <span className="text-xs font-mono text-muted-foreground">({row.bank_code})</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {row.account_count} customer accounts · <Badge variant="secondary" className="text-[10px]">{row.status}</Badge>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-primary">रू {Number(row.total).toFixed(2)}</p>
                      <p className="text-[11px] text-muted-foreground">Master Reserve</p>
                    </div>
                  </div>
                ))}
                {!overview?.circulation.length && (
                  <p className="text-sm text-muted-foreground text-center py-6">No commercial banks registered.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Wholesale Allocation */}
        <TabsContent value="allocate">
          <Card className="max-w-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5 text-primary" /> Wholesale Interbank Liquidity Allocation
              </CardTitle>
              <CardDescription>
                Transfer wholesale digital currency between commercial bank reserves for liquidity balancing or settlement.
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
                              <SelectTrigger><SelectValue placeholder="Select source bank" /></SelectTrigger>
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
                              <SelectTrigger><SelectValue placeholder="Select destination bank" /></SelectTrigger>
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
                        <FormControl><Input placeholder="1000.00" {...field} /></FormControl>
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
                        <FormControl><Input placeholder="e.g. End-of-Day RTGS Settlement" {...field} /></FormControl>
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

        {/* Tab 3: Revoke / Burn */}
        <TabsContent value="burn">
          <Card className="max-w-2xl shadow-sm border-destructive/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                <Flame className="h-5 w-5" /> Revoke / Burn CBDC from Bank
              </CardTitle>
              <CardDescription>
                Retire digital currency from a commercial bank's reserve back into the central bank vault, reducing total M0 supply.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...burnForm}>
                <form onSubmit={burnForm.handleSubmit(onBurn)} className="space-y-4">
                  <FormField
                    control={burnForm.control}
                    name="bank_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Commercial Bank</FormLabel>
                        <FormControl>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
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
                        <FormControl><Input placeholder="500.00" {...field} /></FormControl>
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
                        <FormControl><Input placeholder="e.g. Surplus Liquidity Withdrawal" {...field} /></FormControl>
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
        </TabsContent>

        {/* Tab 4: RBAC / Staff Management */}
        <TabsContent value="staff">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Central Bank Staff & Roles (RBAC)</CardTitle>
                <CardDescription>Manage authorized central bank operators and their cryptographic roles.</CardDescription>
              </div>
              <Dialog open={userModalOpen} onOpenChange={setUserModalOpen}>
                <DialogTrigger asChild>
                  <Button><UserPlus className="h-4 w-4 mr-1" /> Add CB Staff</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Central Bank Staff User</DialogTitle>
                    <DialogDescription>Add a new authenticated central bank operator.</DialogDescription>
                  </DialogHeader>
                  <Form {...staffForm}>
                    <form onSubmit={staffForm.handleSubmit(onCreateStaff)} className="space-y-4">
                      <FormField
                        control={staffForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem><FormLabel>Username</FormLabel><FormControl><Input placeholder="e.g. gov_officer" {...field} /></FormControl><FormMessage /></FormItem>
                        )}
                      />
                      <FormField
                        control={staffForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>
                        )}
                      />
                      <FormField
                        control={staffForm.control}
                        name="role"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Role & Permissions</FormLabel>
                            <FormControl>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="cb_admin">Governor / Super Admin (Full Control)</SelectItem>
                                  <SelectItem value="cb_mint_officer">Minting Officer (Issuance & Allocations)</SelectItem>
                                  <SelectItem value="cb_auditor">Compliance Auditor (Audit & Inspection)</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setUserModalOpen(false)}>Cancel</Button>
                        <Button type="submit">Create Staff User</Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cbStaff.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-semibold">{u.username}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {u.role.replace("cb_", "").replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.role === "cb_admin" && "Full administrative control, bank approvals & minting"}
                        {u.role === "cb_mint_officer" && "Wholesale minting, allocations, and burns"}
                        {u.role === "cb_auditor" && "Zero-knowledge regulatory audit view"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                  {!cbStaff.length && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No staff records.</TableCell></TableRow>
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