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
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Token Layer Public Parameters</CardTitle>
              <CardDescription>
                Live values from <span className="font-mono text-xs">zkatdlog_pp.json</span> — the
                parameters baked into the token chaincode at setup. Regenerating them invalidates
                every token in circulation.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {params ? (
              <div className="divide-y">
                <Param label="Identifier" value={params.identifier} />
                <Param label="Curve (pairing)" value={`id ${params.curve_id} (BN254)`} />
                <Param label="Idemix curve" value={`id ${params.idemix_curve_id}`} />
                <Param label="Quantity precision" value={`${params.quantity_precision} bits`} />
                <Param label="Max token value (minor)" value={params.max_token.toLocaleString("en-IN")} />
                <Param
                  label="Range proof"
                  value={`base ${params.range_proof.base}, exponent ${params.range_proof.exponent ?? "—"}`}
                />
                <Param label="Issuer public keys" value={params.issuers} mono={false} />
                <Param
                  label="Pedersen generators (SHA-256/16)"
                  value={params.pedersen_generators_fingerprint}
                />
                <Param
                  label="Idemix issuer PK (SHA-256/16)"
                  value={params.idemix_issuer_pk_fingerprint}
                />
                <Param label="Auditor MSP" value={params.auditor.msp_id || "—"} />
                <Param
                  label="Auditor cert (SHA-256/16)"
                  value={params.auditor.cert_fingerprint || "—"}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Parameters unavailable — the token chaincode public-params file could not be read
                on this host.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Explainer title="Blind signatures — how wallet privacy works">
            Every wallet holds an <strong className="text-foreground">Idemix credential</strong>: a
            Camenisch–Lysyanskaya (CL) blind signature issued by the token CA over the user's
            secret keys. The user blinds the credential request, so the CA signs attributes it
            never sees; at spend time the wallet derives a{" "}
            <strong className="text-foreground">fresh one-time pseudonym</strong> plus a
            zero-knowledge proof that it owns a validly signed credential. No two transactions can
            be linked to the same wallet by the network, the peers, or anyone watching the ledger.
          </Explainer>
          <Explainer title="Amounts hidden with Pedersen commitments">
            Token amounts never appear in plaintext. Each UTXO is a commitment{" "}
            <span className="font-mono text-foreground">
              C = g0^H(τ) · g1^v · g2^r
            </span>{" "}
            over value v, blinding factor r and token type τ, with a zero-knowledge range proof
            that v is non-negative. The chaincode checks that inputs equal outputs homomorphically
            without learning v.
          </Explainer>
          <Explainer title="The auditor gate">
            The central bank's auditor co-signs every transaction before it commits. Each
            transaction carries an audit opening (value, blinding factors, sender and recipient)
            encrypted under the auditor's public key — so the CB can de-blind any transaction for
            compliance, while the rest of the network sees none of it.
          </Explainer>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Fingerprint className="h-5 w-5 text-muted-foreground" /> Wallet Credentials
          </CardTitle>
          <CardDescription>
            One Idemix credential per customer wallet. Fingerprints are SHA-256 prefixes of the
            wallet's signer configuration on the bank's owner node — shown here for inventory, not
            verification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Wallet id</TableHead>
                <TableHead>Credential type</TableHead>
                <TableHead>Fingerprint</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wallets.map((w) => (
                <TableRow key={w.account_number}>
                  <TableCell className="font-mono text-xs font-semibold">{w.account_number}</TableCell>
                  <TableCell className="font-medium">{w.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{w.wallet}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{w.key_type}</TableCell>
                  <TableCell>
                    {w.credential_fingerprint ? (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {w.credential_fingerprint}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">keys not on this host</span>
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
            Cryptography is provided by the Hyperledger Fabric Token SDK (zkatdlog driver) and IBM
            Idemix; the Sworna stack orchestrates issuance, transfers and audit around them. See{" "}
            <span className="font-mono">docs/token-network/03-utxo-zk-model.md</span> for the full
            protocol.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
