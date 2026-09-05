import * as React from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { KeyRound, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type Bank, type BankPermissions, type OnboardingApplication } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";

const createBankSchema = z.object({
  code: z.string().regex(/^\d{3}$/, "3-digit code, e.g. 003"),
  name: z.string().min(2, "Bank name required"),
  msp_id: z.string().min(3, "MSP ID required (e.g. Bank003MSP)"),
  owner_node: z.string().min(3, "Owner node required (e.g. owner3)"),
  portal_url: z.string(),
  staff_username: z.string(),
  pool_size: z.string().min(1),
});

function PermissionsDialog({
  bank,
  open,
  onOpenChange,
  onSaved,
}: {
  bank: Bank;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [perms, setPerms] = React.useState<BankPermissions>(bank.permissions);
  React.useEffect(() => setPerms(bank.permissions), [bank]);

  async function save() {
    try {
      await api.setBankPermissions(bank.code, perms);
      toast.success(`Permissions updated for ${bank.code}`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "permissions update failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permissions — {bank.name}</DialogTitle>
          <DialogDescription>Set what this bank is allowed to do on the network.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="can-redeem">Can redeem (burn to CB)</Label>
              <p className="text-xs text-muted-foreground">Wholesale redemption of reserves</p>
            </div>
            <Switch
              id="can-redeem"
              checked={perms.can_redeem}
              onCheckedChange={(v) => setPerms({ ...perms, can_redeem: v })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="interbank-limit">Interbank limit (minor units, 0 = unlimited)</Label>
            <Input
              id="interbank-limit"
              inputMode="numeric"
              value={perms.interbank_limit_minor}
              onChange={(e) =>
                setPerms({ ...perms, interbank_limit_minor: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="redeem-limit">Redeem limit (minor units, 0 = unlimited)</Label>
            <Input
              id="redeem-limit"
              inputMode="numeric"
              value={perms.redeem_limit_minor}
              onChange={(e) => setPerms({ ...perms, redeem_limit_minor: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save permissions</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegisterBankDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const form = useForm<z.infer<typeof createBankSchema>>({
    resolver: zodResolver(createBankSchema),
    defaultValues: {
      code: "",
      name: "",
      msp_id: "",
      owner_node: "",
      portal_url: "",
      staff_username: "",
      pool_size: "10",
    },
  });

  async function submit(values: z.infer<typeof createBankSchema>) {
    try {
      await api.createBank({
        code: values.code,
        name: values.name,
        msp_id: values.msp_id,
        owner_node: values.owner_node,
        portal_url: values.portal_url,
        staff_username: values.staff_username || undefined,
        pool_size: Number(values.pool_size) || 10,
      });
      toast.success(`Registered ${values.name} (${values.code})`);
      setOpen(false);
      form.reset();
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "registration failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" /> Add bank
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register commercial bank</DialogTitle>
          <DialogDescription>
            Adds an org to the network registry. Keys are provisioned after creation.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank code (3 digits)</FormLabel>
                  <FormControl><Input placeholder="003" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input placeholder="bankc" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="msp_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>MSP ID</FormLabel>
                  <FormControl><Input placeholder="Bank003MSP" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="owner_node" render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner node</FormLabel>
                  <FormControl><Input placeholder="owner3" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="staff_username" render={({ field }) => (
                <FormItem>
                  <FormLabel>Staff username (optional)</FormLabel>
                  <FormControl><Input placeholder="bankc_admin" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="pool_size" render={({ field }) => (
                <FormItem>
                  <FormLabel>Wallet pool size</FormLabel>
                  <FormControl><Input inputMode="numeric" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="portal_url" render={({ field }) => (
              <FormItem>
                <FormLabel>Portal URL (optional)</FormLabel>
                <FormControl><Input placeholder="http://…" {...field} /></FormControl>
              </FormItem>
            )} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Register bank</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function CBBanks() {
  const [banks, setBanks] = React.useState<Bank[]>([]);
  const [apps, setApps] = React.useState<OnboardingApplication[]>([]);
  const [admittingCode, setAdmittingCode] = React.useState<string | null>(null);
  const [permBank, setPermBank] = React.useState<Bank | null>(null);

  async function load() {
    try {
      const [banksData, appsData] = await Promise.all([
        api.banks(),
        api.onboardingApplications().catch(() => []),
      ]);
      setBanks(banksData);
      setApps(appsData.filter((a) => a.status !== "approved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "load failed");
    }
  }

  React.useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleAdmit(code: string) {
    setAdmittingCode(code);
    try {
      await api.admitBankFast(code);
      toast.success(`Bank ${code} admitted to network and channel successfully!`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Admission failed");
    } finally {
      setAdmittingCode(null);
    }
  }

  async function provision(code: string) {
    try {
      const res = await api.provision(code);
      toast.success(
        `Provisioned bank ${code}: ${res.wallets_generated} new wallets, ${res.free} free in pool`,
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "provision failed");
    }
  }

  async function setStatus(code: string, status: Bank["status"]) {
    try {
      await api.setBankStatus(code, status);
      toast.success(`Bank ${code} → ${status}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "status update failed");
    }
  }

  return (
    <div className="space-y-6">
      {apps.length > 0 && (
        <Card className="border-primary/40 bg-primary/5 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
              Pending Bank Admissions ({apps.length})
            </CardTitle>
            <CardDescription>
              Commercial banks requesting admission to the Sworna CBDC settlement channel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bank</TableHead>
                  <TableHead>MSP ID</TableHead>
                  <TableHead>Peer Endpoint</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((app) => (
                  <TableRow key={app.bank_code}>
                    <TableCell>
                      <p className="font-medium">{app.legal_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{app.bank_code}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{app.msp_id}</TableCell>
                    <TableCell className="font-mono text-xs">{app.peer_endpoint}</TableCell>
                    <TableCell className="text-xs">{fmtDate(app.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={admittingCode === app.bank_code}
                        onClick={() => handleAdmit(app.bank_code)}
                      >
                        {admittingCode === app.bank_code ? "Admitting..." : "Approve & Admit to Network"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Commercial banks on the network</CardTitle>
          <CardDescription>
            Registration, token-CA provisioning, lifecycle status and settlement permissions.
          </CardDescription>
        </div>
        <RegisterBankDialog onCreated={load} />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bank</TableHead>
              <TableHead>MSP</TableHead>
              <TableHead>Owner node</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {banks.map((b) => (
              <TableRow key={b.code}>
                <TableCell>
                  <p className="font-medium">{b.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{b.code}</p>
                </TableCell>
                <TableCell className="font-mono text-xs">{b.msp_id}</TableCell>
                <TableCell className="font-mono text-xs">{b.owner_node}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select value={b.status} onValueChange={(v) => setStatus(b.code, v as Bank["status"])}>
                      <SelectTrigger className="h-7 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="registered">registered</SelectItem>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="suspended">suspended</SelectItem>
                      </SelectContent>
                    </Select>
                    {b.status === "suspended" && (
                      <Badge variant="destructive" className="text-[10px]">
                        payments blocked
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs">{fmtDate(b.joined_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => provision(b.code)}>
                      <KeyRound className="mr-1 h-3 w-3" /> Provision keys
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPermBank(b)}>
                      <ShieldCheck className="mr-1 h-3 w-3" /> Permissions
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!banks.length && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  No banks yet. Register one to start.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      {permBank && (
        <PermissionsDialog
          bank={permBank}
          open={!!permBank}
          onOpenChange={(o) => !o && setPermBank(null)}
          onSaved={load}
        />
      )}
      </Card>
    </div>
  );
}
