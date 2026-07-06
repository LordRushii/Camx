"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator" | "viewer";
  status: "active" | "suspended";
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<SystemUser[]>([
    { id: "usr-1", name: "Rushikesh Jadhav", email: "rushi@example.com", role: "admin", status: "active" },
    { id: "usr-2", name: "Operator Dave", email: "dave@example.com", role: "operator", status: "active" },
    { id: "usr-3", name: "Viewer Wendy", email: "wendy@example.com", role: "viewer", status: "suspended" },
  ]);

  const handleToggleStatus = (id: string) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id
          ? { ...u, status: u.status === "active" ? "suspended" : "active" }
          : u
      )
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">User Management</h3>
        <p className="text-sm text-muted-foreground">
          Control access credentials, assign operator authorization, and review active sessions.
        </p>
      </div>
      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>System Accounts</CardTitle>
          <CardDescription>
            Configure user profiles authorized to access the live video desk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative w-full overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-left text-xs uppercase tracking-wider font-semibold">
                  <th className="p-3">User</th>
                  <th className="p-3">Email Address</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/10 transition-colors">
                    <td className="p-3 font-semibold">{user.name}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{user.email}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="capitalize">
                        {user.role}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={
                          user.status === "active"
                            ? "bg-status-nominal/10 text-status-nominal border-status-nominal/30"
                            : "bg-status-critical/10 text-status-critical border-status-critical/30"
                        }
                      >
                        {user.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(user.id)}
                        className="cursor-pointer"
                      >
                        {user.status === "active" ? "Suspend" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
