"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BellIcon,
  UserIcon,
  Settings01Icon,
  GridIcon,
  AnalyticsIcon,
  ActivityIcon,
  ComputerIcon
} from "@hugeicons/core-free-icons";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { href: "/", label: "Detect Grid", icon: GridIcon },
  { href: "/monitor", label: "Live Monitor", icon: ComputerIcon },
  { href: "/analysis", label: "Analysis & Q&A", icon: AnalyticsIcon },
  { href: "/operations", label: "Operations Desk", icon: ActivityIcon },
  { href: "/settings", label: "Settings", icon: Settings01Icon },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between px-6">
        {/* Left: Brand logo + nav items */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-heading text-lg font-bold tracking-tight text-primary bg-clip-text">
              CAMX2
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
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
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Notifications */}
          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground relative cursor-pointer">
            <HugeiconsIcon icon={BellIcon} className="w-4.5 h-4.5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-status-critical animate-pulse" />
          </Button>

          {/* Theme switcher */}
          <ThemeSwitcher />

          {/* Profile Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className={buttonVariants({ variant: "ghost", size: "icon", className: "w-8 h-8 rounded-full border border-border bg-muted cursor-pointer" })}>
              <HugeiconsIcon icon={UserIcon} className="w-4 h-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Account Settings</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer">
                <Link href="/settings/user-management" className="flex w-full items-center gap-2">
                  <span>User Profile</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <Link href="/settings/deployment-profile" className="flex w-full items-center gap-2">
                  <span>Deployment Profile</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive cursor-pointer">
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
