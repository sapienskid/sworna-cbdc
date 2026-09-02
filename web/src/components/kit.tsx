import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  accent,
  children,
}: {
  title: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card className={cn("shadow-sm", accent && "border-l-4 border-l-primary")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {value === null ? (
          <Skeleton className="h-9 w-36" />
        ) : (
          <p className="text-3xl font-extrabold tabular-nums tracking-tight">{value}</p>
        )}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

/** Monochrome horizontal bar chart (pure SVG, no chart dependency). */
export function BarList({
  rows,
  formatter,
}: {
  rows: { label: string; value: number; sub?: string }[];
  formatter?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium">{r.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatter ? formatter(r.value) : r.value}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
          {r.sub && <p className="mt-0.5 text-xs text-muted-foreground">{r.sub}</p>}
        </div>
      ))}
      {!rows.length && <p className="py-4 text-center text-sm text-muted-foreground">No data.</p>}
    </div>
  );
}

/** Vertical bar sparkline (monochrome) for volume-over-time. */
export function Sparkline({ values, labels }: { values: number[]; labels?: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="flex h-24 items-end gap-1">
        {values.map((v, i) => (
          <div
            key={i}
            title={labels ? `${labels[i]}: ${v}` : String(v)}
            className={cn(
              "flex-1 rounded-t-sm bg-primary/80 transition-all hover:bg-primary",
              v === 0 && "bg-muted",
            )}
            style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
          />
        ))}
      </div>
      {labels && (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}
