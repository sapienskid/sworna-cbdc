import * as React from "react";
import { AlertTriangle, Ban, CheckCircle2, EyeOff, Plus, RefreshCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/kit";
import { api, type AMLAlert, type AMLSummary, type WatchlistEntry } from "@/lib/api";
import { downloadCsv, fmtDateTime, fmtSwr, shortTxid } from "@/lib/format";
import { toast } from "sonner";

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const RULE_LABELS: Record<string, string> = {
  large_transaction: "Large transaction",
  velocity: "Velocity breach",
  structuring: "Structuring",
  watchlist: "Watchlist hit",
  auto_flag: "Auto-flag",
};

function AlertRow({ alert, onReview }: { alert: AMLAlert; onReview: (a: AMLAlert, status: AMLAlert["status"]) => void }) {
  return (
    <TableRow>
      <TableCell>
        <Badge variant={SEVERITY_VARIANT[alert.severity] ?? "outline"}>{alert.severity}</Badge>
      </TableCell>
      <TableCell className="font-medium">{RULE_LABELS[alert.rule] ?? alert.rule}</TableCell>
      <TableCell className="font-mono text-xs">{alert.account_number || "—"}</TableCell>
      <TableCell className="font-mono text-xs">{alert.counterparty || "—"}</TableCell>
      <TableCell className="tabular-nums">{Number(alert.amount) ? fmtSwr(alert.amount) : "—"}</TableCell>
      <TableCell className="max-w-xs">
        <p className="truncate text-xs text-muted-foreground" title={alert.details}>
          {alert.details}
        </p>
        {alert.txid && <p className="font-mono text-[10px] text-muted-foreground">{shortTxid(alert.txid)}</p>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {fmtDateTime(alert.created_at)}
      </TableCell>
      <TableCell>
        {alert.status === "open" ? (
          <div className="flex justify-end gap-1">
            <Button variant="outline" size="sm" onClick={() => onReview(alert, "reviewed")}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Review
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onReview(alert, "dismissed")}>
              <EyeOff className="mr-1 h-3.5 w-3.5" /> Dismiss
            </Button>
          </div>
        ) : (
          <Badge variant="outline" className="capitalize">
            {alert.status}
            {alert.reviewed_by ? ` · ${alert.reviewed_by}` : ""}
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

export function CBCompliance() {
  const [summary, setSummary] = React.useState<AMLSummary | null>(null);
  const [alerts, setAlerts] = React.useState<AMLAlert[]>([]);
  const [watchlist, setWatchlist] = React.useState<WatchlistEntry[]>([]);
  const [statusFilter, setStatusFilter] = React.useState("open");
  const [severityFilter, setSeverityFilter] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [entryOpen, setEntryOpen] = React.useState(false);
  const [newValue, setNewValue] = React.useState("");
  const [newType, setNewType] = React.useState<WatchlistEntry["list_type"]>("sanction");
  const [newNote, setNewNote] = React.useState("");

  async function load() {
    setLoading(true);
    try {
      const [s, a, w] = await Promise.all([
        api.amlSummary(),
        api.amlAlerts({ status: statusFilter || undefined, severity: severityFilter || undefined }),
        api.watchlist(),
      ]);
      setSummary(s);
      setAlerts(a);
      setWatchlist(w);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [statusFilter, severityFilter]);

  async function onReview(alert: AMLAlert, status: AMLAlert["status"]) {
    try {
      await api.reviewAlert(alert.id, status);
      toast.success(`Alert #${alert.id} ${status}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function onAddEntry() {
    if (newValue.trim().length < 2) {
      toast.error("Watchlist value must be at least 2 characters");
      return;
    }
    try {
      await api.addWatchlistEntry({ list_type: newType, value: newValue.trim(), note: newNote });
      toast.success(`Added "${newValue.trim()}" to the ${newType} watchlist`);
      setEntryOpen(false);
      setNewValue("");
      setNewNote("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add entry");
    }
  }

  async function onDeactivate(entry: WatchlistEntry) {
    try {
      await api.deactivateWatchlistEntry(entry.id);
      toast.success(`Deactivated "${entry.value}"`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not deactivate entry");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          accent
          title="Open Alerts"
          value={summary ? summary.open_alerts : null}
          hint="Awaiting compliance review"
          icon={ShieldAlert}
        />
        <StatCard
          title="High Severity"
          value={summary ? summary.open_by_severity["high"] ?? 0 : null}
          hint="Velocity, structuring & sanctions hits"
          icon={AlertTriangle}
        />
        <StatCard
          title="Flagged Accounts"
          value={summary ? summary.flagged_accounts : null}
          hint="Auto-flagged by AML rules — payments blocked until cleared"
          icon={Ban}
        />
        <StatCard
          title="Reportable Threshold"
          value={summary ? `रू ${fmtSwr(summary.reportable_threshold)}` : null}
          hint="Single outflows at or above this raise an alert"
          icon={CheckCircle2}
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">AML Alerts</CardTitle>
            <CardDescription>
              Rule hits raised by the off-chain AML engine. Review or dismiss; auto-flagged
              accounts stay payment-blocked until bank staff reset their status.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
                <SelectItem value="">All</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-8 w-32">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All severities</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  "aml-alerts.csv",
                  alerts.map((a) => ({
                    id: a.id, rule: a.rule, severity: a.severity, status: a.status,
                    account: a.account_number, counterparty: a.counterparty,
                    amount: a.amount, details: a.details, created_at: a.created_at,
                  })),
                )
              }
              disabled={!alerts.length}
            >
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((a) => (
                <AlertRow key={a.id} alert={a} onReview={onReview} />
              ))}
              {!alerts.length && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                    No {statusFilter || ""} alerts. The engine raises alerts automatically as
                    payments flow.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Watchlist</CardTitle>
            <CardDescription>
              Names screened at onboarding and against every transfer counterparty. Sanctions
              matches block payments; PEP / internal matches raise alerts.
            </CardDescription>
          </div>
          <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add entry</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add watchlist entry</DialogTitle>
                <DialogDescription>
                  Matched case-insensitively against customer full names.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>List type</Label>
                  <Select value={newType} onValueChange={(v) => setNewType(v as WatchlistEntry["list_type"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sanction">Sanctions — blocks payments</SelectItem>
                      <SelectItem value="pep">Politically exposed person</SelectItem>
                      <SelectItem value="internal">Internal watchlist</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Name to match</Label>
                  <Input
                    placeholder="e.g. John Doe"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Note</Label>
                  <Input
                    placeholder="Source / reason"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEntryOpen(false)}>Cancel</Button>
                <Button onClick={onAddEntry}>Add entry</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Added by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {watchlist.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <Badge variant={w.list_type === "sanction" ? "destructive" : "secondary"}>
                      {w.list_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{w.value}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{w.note || "—"}</TableCell>
                  <TableCell className="text-xs">{w.created_by || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={w.active ? "outline" : "secondary"}>
                      {w.active ? "active" : "inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {w.active && (
                      <Button variant="ghost" size="sm" onClick={() => onDeactivate(w)}>
                        Deactivate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!watchlist.length && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    Watchlist is empty. Add sanctions or PEP names to start screening.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {summary && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">KYC tier limits in force</CardTitle>
            <CardDescription>
              Effective per-transaction cap is the lower of the account's own limit and the tier
              cap; cumulative daily limits and counts are enforced per UTC day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-right">Per-transaction cap</TableHead>
                  <TableHead className="text-right">Daily cumulative cap</TableHead>
                  <TableHead className="text-right">Daily tx count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(summary.kyc_tiers).map(([key, t]) => (
                  <TableRow key={key}>
                    <TableCell className="font-mono text-xs">{key.replace("tier_", "T")}</TableCell>
                    <TableCell className="font-medium">{t.label}</TableCell>
                    <TableCell className="text-right tabular-nums">रू {fmtSwr(t.per_tx_minor / 100)}</TableCell>
                    <TableCell className="text-right tabular-nums">रू {fmtSwr(t.daily_minor / 100)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.daily_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
