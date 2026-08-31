import * as React from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type Bank, type BankPermissions } from "@/lib/api";
import { toast } from "sonner";

export function CBBanks() {
  const [banks, setBanks] = React.useState<Bank[]>([]);
  const [permissionsFor, setPermissionsFor] = React.useState<Bank | null>(null);
  const [perms, setPerms] = React.useState<BankPermissions>({ can_redeem: true, interbank_limit_minor: 0, redeem_limit_minor: 0 });

  async function load() {
    try {
      setBanks(await api.banks());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "load failed");
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  async function provision(code: string) {
    try {
      const res = await api.provision(code);
      toast.success(`Provisioned ${res.wallets_generated} wallets for bank ${code}`);
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

  function openPermissions(bank: Bank) {
    setPermissionsFor(bank);
    setPerms(bank.permissions);
  }

  async function savePermissions() {
    if (!permissionsFor) return;
    try {
      await api.setBankPermissions(permissionsFor.code, perms);
      toast.success(`Permissions updated for ${permissionsFor.code}`);
      setPermissionsFor(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "permissions update failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">All banks on the network</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bank</TableHead>
              <TableHead>MSP</TableHead>
              <TableHead>Owner node</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pool</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {banks.map((b) => (
              <TableRow key={b.code}>
                <TableCell>
                  <p className="font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.code}</p>
                </TableCell>
                <TableCell className="font-mono text-xs">{b.msp_id}</TableCell>
                <TableCell className="font-mono text-xs">{b.owner_node}</TableCell>
                <TableCell>
                  <Select value={b.status} onValueChange={(v) => setStatus(b.code, v as Bank["status"])}>
                    <SelectTrigger className="h-7 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="registered">registered</SelectItem>
                      <SelectItem value="active">active</SelectItem>
                      <SelectItem value="suspended">suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-xs">{b.pool_size} wallets</TableCell>
                <TableCell className="text-xs">{b.joined_at ? new Date(b.joined_at.includes("T") ? b.joined_at : b.joined_at.replace(" ", "T") + "Z").toLocaleDateString() : "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => provision(b.code)}>
                      <KeyRound className="mr-1 h-3 w-3" /> Generate keys
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openPermissions(b)}>
                      <ShieldCheck className="mr-1 h-3 w-3" /> Permissions
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!banks.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  No banks yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!permissionsFor} onOpenChange={(o) => !o && setPermissionsFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permissions — {permissionsFor?.name}</DialogTitle>
            <DialogDescription>Set what this bank is allowed to do.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Can redeem (burn to CB)</span>
              <Badge
                className="cursor-pointer select-none"
                variant={perms.can_redeem ? "default" : "secondary"}
                onClick={() => setPerms({ ...perms, can_redeem: !perms.can_redeem })}
              >
                {perms.can_redeem ? "allowed" : "blocked"}
              </Badge>
            </div>
            <label className="block text-sm">
              Interbank limit (minor units; 0 = unlimited)
              <input
                type="number"
                className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={perms.interbank_limit_minor}
                onChange={(e) => setPerms({ ...perms, interbank_limit_minor: Number(e.target.value) })}
              />
            </label>
            <label className="block text-sm">
              Redeem limit (minor units; 0 = unlimited)
              <input
                type="number"
                className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={perms.redeem_limit_minor}
                onChange={(e) => setPerms({ ...perms, redeem_limit_minor: Number(e.target.value) })}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermissionsFor(null)}>Cancel</Button>
            <Button onClick={savePermissions}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}