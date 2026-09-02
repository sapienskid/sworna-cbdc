import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const schema = z.object({
  username: z.string().min(1, "Username required"),
  password: z.string().min(1, "Password required"),
});

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof schema>) {
    try {
      const user = await login(values.username, values.password);
      if (["cb_admin", "cb_mint_officer", "cb_auditor"].includes(user.role)) navigate("/cb");
      else navigate(`/b/${user.bank_code ?? "001"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Login failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-xl border bg-background shadow-lg md:grid md:grid-cols-2">
        {/* Brand panel */}
        <div className="hidden flex-col justify-between border-r bg-muted/30 p-10 md:flex">
          <div className="flex items-center gap-3">
            <span className="text-4xl font-bold text-primary">रू</span>
            <div>
              <p className="text-lg font-semibold leading-tight">Sworna CBDC</p>
              <p className="text-xs text-muted-foreground">Digital currency settlement platform</p>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Two-tier retail CBDC on a permissioned ledger. Privacy-preserving wallets, real-time
              wholesale settlement, and central-bank supervisory access.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Zero-knowledge UTXO</Badge>
              <Badge variant="outline">Idemix privacy</Badge>
              <Badge variant="outline">AML supervision</Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Authorized operators only. All activity is attributed and audited.
          </p>
        </div>

        {/* Login form */}
        <div className="flex items-center justify-center p-8">
          <div className="w-full max-w-sm">
            <CardHeader className="px-0 pt-0 text-left md:hidden">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-3xl font-bold text-primary">रू</span>
                <CardTitle>Sworna CBDC</CardTitle>
              </div>
              <CardDescription>Sign in to the banking portal</CardDescription>
            </CardHeader>
            <div className="hidden md:block">
              <CardTitle className="text-xl">Sign in</CardTitle>
              <CardDescription className="mt-1">
                Use the credentials issued by your administrator.
              </CardDescription>
            </div>
            <CardContent className="px-0 pb-0">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 space-y-4">
                  <FormField control={form.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="Your operator or customer username" autoComplete="username" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" autoComplete="current-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                    <Landmark className="mr-1.5 h-4 w-4" /> Sign in
                  </Button>
                </form>
              </Form>
              <p className="mt-6 text-center text-xs text-muted-foreground">
                Lost credentials? Contact your bank's administrator or the central bank.
              </p>
            </CardContent>
          </div>
        </div>
      </div>
    </div>
  );
}
