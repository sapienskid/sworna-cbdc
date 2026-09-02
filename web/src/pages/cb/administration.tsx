import * as React from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type UserRead } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";

const staffSchema = z.object({
  username: z.string().min(3, "Min 3 characters"),
  password: z.string().min(6, "Min 6 characters"),
  role: z.enum(["cb_admin", "cb_mint_officer", "cb_auditor"]),
  full_name: z.string(),
});

const ROLE_DESCRIPTIONS: Record<string, string> = {
  cb_admin: "Full administrative control, bank approvals & minting",
  cb_mint_officer: "Wholesale minting, allocations, and burns",
  cb_auditor: "Zero-knowledge regulatory audit & AML review",
};

export function CBAdministration() {
  const [staff, setStaff] = React.useState<UserRead[]>([]);
  const [open, setOpen] = React.useState(false);
  const form = useForm<z.infer<typeof staffSchema>>({
    resolver: zodResolver(staffSchema),
    defaultValues: { username: "", password: "", role: "cb_mint_officer", full_name: "" },
  });

  async function load() {
    try {
      setStaff(await api.cbUsers());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    }
  }
  React.useEffect(() => {
    load();
  }, []);

  async function onCreate(values: z.infer<typeof staffSchema>) {
    try {
      await api.createCbUser(values);
      toast.success(`Central bank staff ${values.username} created`);
      setOpen(false);
      form.reset();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Staff creation failed");
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Central Bank Staff & Roles (RBAC)</CardTitle>
          <CardDescription>
            Manage authorized central bank operators. Roles gate the API: minting officers can
            mint/allocate/burn, auditors review AML alerts, admins do everything.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><UserPlus className="mr-1 h-4 w-4" /> Add CB Staff</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Central Bank Staff User</DialogTitle>
              <DialogDescription>Add a new authenticated central bank operator.</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onCreate)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. gov_officer" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
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
                            <SelectItem value="cb_auditor">Compliance Auditor (Audit & AML Review)</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
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
            {staff.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-semibold">{u.username}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {u.role.replace("cb_", "").replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {ROLE_DESCRIPTIONS[u.role] ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(u.created_at)}</TableCell>
              </TableRow>
            ))}
            {!staff.length && (
              <TableRow>
                <TableCell colSpan={4} className="py-4 text-center text-muted-foreground">
                  No staff records.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
