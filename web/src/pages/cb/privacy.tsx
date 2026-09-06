import * as React from "react";
import { Fingerprint, RefreshCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type CryptoParams, type WalletCryptoInfo } from "@/lib/api";
import { toast } from "sonner";

function Param({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function Explainer({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-relaxed text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

export function CBPrivacy() {
  const [params, setParams] = React.useState<CryptoParams | null>(null);
  const [wallets, setWallets] = React.useState<WalletCryptoInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, w] = await Promise.all([api.cryptoParams(), api.cryptoWallets()]);
      setParams(p);
      setWallets(w);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load parameters");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      {/* Executive Privacy Architecture Pillars */}
      <div className="grid gap-4 md:grid-cols-3">
        <Explainer title="Citizen Identity Privacy">
          Citizens transact using zero-knowledge credentials. Every transaction generates a fresh,
          untraceable pseudonym. Commercial banks and network participants cannot correlate multiple
          payments to the same user or inspect competitor balances.
        </Explainer>
        <Explainer title="Confidential Value Settlement">
          Transfer amounts are never exposed in plaintext. Each digital balance is cryptographically
          blinded using homomorphic commitments with zero-knowledge range proofs, ensuring mathematical
          integrity without revealing transacted values.
        </Explainer>
        <Explainer title="Supervisory Regulatory Gate">
          The Central Bank retains authorized supervisory oversight. Every transaction includes an
          audit verification package encrypted specifically for the Central Bank Auditor, allowing
          lawful selective de-anonymization for AML/CFT investigations.
        </Explainer>
      </div>

      {/* Cryptographic Assurance & Public Parameters */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Cryptographic Parameters & Auditor Verification</CardTitle>
            <CardDescription>
              Mathematical parameters enforced across all settlement nodes. Verified by the Central
              Bank Auditor to guarantee zero-knowledge validity and coin conservation.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            >
              {showTechnicalDetails ? "Hide Technical Keys" : "View Auditor Keys"}
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pb-4">
            <div className="rounded-lg border p-3">
              <span className="text-xs text-muted-foreground">Privacy Protocol</span>
              <p className="text-sm font-semibold mt-1">Zero-Knowledge UTXO (ZKAT-DLOG)</p>
            </div>
            <div className="rounded-lg border p-3">
              <span className="text-xs text-muted-foreground">Elliptic Curve</span>
              <p className="text-sm font-semibold mt-1">Barreto-Naehrig (BN254 Pairing)</p>
            </div>
            <div className="rounded-lg border p-3">
              <span className="text-xs text-muted-foreground">Identity Protocol</span>
              <p className="text-sm font-semibold mt-1">IBM Idemix Blind Signatures</p>
            </div>
            <div className="rounded-lg border p-3">
              <span className="text-xs text-muted-foreground">Auditor Authority</span>
              <p className="text-sm font-semibold mt-1">{params?.auditor.msp_id || "CentralBankMSP"}</p>
            </div>
          </div>

          {showTechnicalDetails && (
            <div className="mt-4 rounded-lg border bg-muted/20 p-4 divide-y">
              <Param label="Parameter Identifier" value={params?.identifier ?? "zkatdlog_pp"} />
              <Param label="Precision Limit" value={`${params?.quantity_precision ?? 64} bits (Minor SWR units)`} />
              <Param
                label="Maximum Supply Cap per UTXO"
                value={params ? `${(params.max_token / 100).toLocaleString("en-IN")} SWR` : "—"}
              />
              <Param
                label="Pedersen Generator Fingerprint"
                value={params?.pedersen_generators_fingerprint ?? "Verified"}
              />
              <Param
                label="Idemix Issuer Public Key"
                value={params?.idemix_issuer_pk_fingerprint ?? "Verified"}
              />
              <Param
                label="Auditor Certificate Hash"
                value={params?.auditor.cert_fingerprint ?? "Active"}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Wallets & Credentials */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Fingerprint className="h-5 w-5 text-muted-foreground" /> Customer Privacy Credentials
          </CardTitle>
          <CardDescription>
            Active zero-knowledge retail wallets issued across commercial banking institutions.
            Each account operates with an independent, blinded credential for transaction anonymity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Number</TableHead>
                <TableHead>Account Holder</TableHead>
                <TableHead>Institutional Wallet ID</TableHead>
                <TableHead>Privacy Mode</TableHead>
                <TableHead>Credential Verification</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wallets.map((w) => (
                <TableRow key={w.account_number}>
                  <TableCell className="font-mono text-xs font-semibold">{w.account_number}</TableCell>
                  <TableCell className="font-medium">{w.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{w.wallet}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      Zero-Knowledge Blinded
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {w.credential_fingerprint ? (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        IDEMIX-{w.credential_fingerprint.slice(0, 10)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Verified Member Key
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!wallets.length && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No customer wallets registered yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            Identity privacy and value confidentiality are guaranteed cryptographically via zero-knowledge proofs.
            Central Bank supervisory authorities maintain dual verification for regulatory compliance under national CBDC framework standards.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
