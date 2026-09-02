import * as React from "react";
import { Blocks, Download, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkline } from "@/components/kit";
import { api, type LedgerStatus, type TxLog } from "@/lib/api";
import { downloadCsv, fmtDateTime, fmtSwr, shortTxid, txTypeLabel } from "@/lib/format";
import { toast } from "sonner";

const PAGE_SIZE = 15;

export function CBLedger() {
  const [ledger, setLedger] = React.useState<LedgerStatus | null>(null);
  const [txns, setTxns] = React.useState<TxLog[]>([]);
  const [typeFilter, setTypeFilter] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const [lg, tr] = await Promise.all([api.ledger().catch(() => null), api.transactions()]);
      setLedger(lg);
      setTxns(tr);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => setPage(0), [typeFilter, query]);

  const filtered = txns.filter((t) => {
    if (typeFilter && t.tx_type !== typeFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        t.from_account.toLowerCase().includes(q) ||
        t.to_account.toLowerCase().includes(q) ||
        t.reference.toLowerCase().includes(q) ||
        t.txid.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // daily volume for the last 14 days (monochrome sparkline)
  const days = React.useMemo(() => {
    const buckets = new Map<string, number>();
    const isoKeys: string[] = [];
    const labels: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      isoKeys.push(d);
      labels.push(d.slice(5));
      buckets.set(d, 0);
    }
    for (const t of txns) {
      const day = t.created_at.slice(0, 10);
      if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + Number(t.amount));
    }
    return { labels, values: isoKeys.map((k) => buckets.get(k) ?? 0) };
  }, [txns]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Blocks className="h-4 w-4 text-muted-foreground" /> Ledger monitor
            </CardTitle>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              channel <span className="font-mono text-foreground">{ledger?.channel ?? "…"}</span> ·
              height <span className="font-semibold text-foreground">{ledger?.height ?? "…"}</span>
            </p>
            {!ledger && (
              <p className="mt-2 text-xs text-muted-foreground">
                Peer CLI unreachable from this host — block data unavailable.
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Block</TableHead>
                  <TableHead>Tx</TableHead>
                  <TableHead>Tx ids</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger?.blocks.slice().reverse().map((b) => (
                  <TableRow key={b.number}>
                    <TableCell className="font-mono text-xs">{b.number}</TableCell>
                    <TableCell>{b.tx_count}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {b.txids.map((t) => shortTxid(t)).join(", ") || "config"}
                    </TableCell>
                  </TableRow>
                ))}
                {!ledger?.blocks.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-4 text-center text-sm text-muted-foreground">
                      No recent blocks.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Transaction volume (14 days)</CardTitle>
            <CardDescription>Off-chain payment mirror, SWR per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <Sparkline values={days.values} labels={days.labels} />
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="h-4 w-4 text-muted-foreground" /> Recent transactions
            </CardTitle>
            <CardDescription>Off-chain mirror of settlement activity.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search account, reference, txid…"
              className="h-8 w-56"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {["issue", "transfer", "redeem", "deposit", "withdraw", "burn", "wholesale_allocation"].map((t) => (
                  <SelectItem key={t} value={t}>{txTypeLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  "transactions.csv",
                  filtered.map((t) => ({
                    txid: t.txid, type: t.tx_type, from: t.from_account, to: t.to_account,
                    amount: t.amount, reference: t.reference, status: t.status, created_at: t.created_at,
                  })),
                )
              }
              disabled={!filtered.length}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((t, i) => (
                <TableRow key={`${t.txid}-${i}`}>
                  <TableCell>
                    <Badge variant={t.tx_type === "issue" ? "default" : t.tx_type === "redeem" || t.tx_type === "burn" ? "destructive" : "secondary"}>
                      {txTypeLabel(t.tx_type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.from_account || "CB"}</TableCell>
                  <TableCell className="font-mono text-xs">{t.to_account || "CB"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtSwr(t.amount)}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {t.reference || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {fmtDateTime(t.created_at)}
                  </TableCell>
                </TableRow>
              ))}
              {!pageRows.length && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No transactions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {filtered.length} transactions · page {page + 1} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
