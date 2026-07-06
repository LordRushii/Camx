"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Settings01Icon,
  CameraVideoIcon,
  ShieldIcon,
  BellIcon,
  ComputerIcon,
  UserIcon,
  UserCheck01Icon
} from "@hugeicons/core-free-icons";

const settingsNavItems = [
  { href: "/settings/model-configuration", label: "Model Configuration", icon: Settings01Icon },
  { href: "/settings/camera-management", label: "Camera Management", icon: CameraVideoIcon },
  { href: "/settings/threat-log", label: "Threat Log", icon: ShieldIcon },
  { href: "/settings/alert-configuration", label: "Alert Configuration", icon: BellIcon },
  { href: "/settings/deployment-profile", label: "Deployment Profile", icon: ComputerIcon },
  { href: "/settings/face-enrollment", label: "Face Enrollment", icon: UserIcon },
  { href: "/settings/user-management", label: "User Management", icon: UserCheck01Icon },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] bg-muted/20">
      {/* Settings Sidebar */}
      <aside className="w-64 border-r border-border bg-background p-6 space-y-4 shrink-0">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Settings</h2>
          <p className="text-xs text-muted-foreground">Configure your system preferences.</p>
        </div>
        <nav className="flex flex-col gap-1">
          {settingsNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href === "/settings/face-enrollment" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <HugeiconsIcon icon={item.icon} className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Settings Viewport */}
      <div className="flex-1 p-8 overflow-y-auto max-w-5xl">
        {children}
      </div>
    </div>
  );
}
