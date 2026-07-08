"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useDataTable } from "@/hooks/use-data-table";
import { type ColumnDef } from "@tanstack/react-table";
import { useOptimistic } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Download, ShieldAlert } from "lucide-react";
import { Doc, Id } from "@/convex/_generated/dataModel";

type ThreatLog = Doc<"threatLogs">;

function ThreatLogPageContent() {
  const allLogs = useQuery(api.threatLogs.listAll);
  const cameras = useQuery(api.cameras.list);
  const updateStatus = useMutation(api.threatLogs.updateStatus);

  // Map camera IDs to camera names for lookup
  const camerasMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    if (cameras) {
      for (const camera of cameras) {
        map[camera.cameraId] = camera.name;
      }
    }
    return map;
  }, [cameras]);

  // Optimistic updates for row statuses
  const [optimisticStatusMap, setOptimisticStatusMap] = useOptimistic(
    new Map<string, string>(),
    (state, update: { id: string; status: string }) => {
      const nextState = new Map(state);
      nextState.set(update.id, update.status);
      return nextState;
    }
  );

  const [, startTransition] = React.useTransition();

  const handleStatusChange = React.useCallback((id: string, newStatus: "ACTIVE" | "ACKNOWLEDGED" | "ESCALATED" | "FALSE_POSITIVE") => {
    startTransition(async () => {
      setOptimisticStatusMap({ id, status: newStatus });
      try {
        await updateStatus({ ids: [id as Id<"threatLogs">], status: newStatus });
      } catch (err) {
        console.error("Failed to update status:", err);
      }
    });
  }, [updateStatus, setOptimisticStatusMap]);

  // Define columns for useDataTable hook
  const columns = React.useMemo<ColumnDef<ThreatLog>[]>(
    () => [
      {
        id: "timestamp",
        accessorKey: "timestamp",
        header: "Timestamp",
        cell: ({ row }) => {
          const date = new Date(row.original.timestamp);
          return (
            <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
              {date.toLocaleDateString()} {date.toLocaleTimeString()}
            </span>
          );
        },
      },
      {
        id: "cameraId",
        accessorKey: "cameraId",
        header: "Camera",
        enableColumnFilter: true,
        cell: ({ row }) => {
          const cameraId = row.original.cameraId;
          const cameraName = camerasMap[cameraId] || cameraId;
          return <span className="font-medium whitespace-nowrap">{cameraName}</span>;
        },
      },
      {
        id: "classification",
        accessorKey: "classification",
        header: "Target Object",
        enableColumnFilter: true,
        cell: ({ row }) => (
          <div className="max-w-[240px]">
            <div className="font-semibold text-foreground text-sm line-clamp-1">
              {row.original.classification}
            </div>
            {row.original.previewText && (
              <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5 font-light">
                {row.original.previewText}
              </div>
            )}
          </div>
        ),
      },
      {
        id: "confidence",
        accessorKey: "confidence",
        header: "Confidence",
        cell: ({ row }) => (
          <span className="font-mono text-xs font-semibold">
            {Math.round(row.original.confidence)}%
          </span>
        ),
      },
      {
        id: "severity",
        accessorKey: "severity",
        header: "Severity",
        enableColumnFilter: true,
        cell: ({ row }) => {
          const severity = row.original.severity;
          return (
            <Badge
              variant="outline"
              className={
                severity === "critical"
                  ? "bg-status-critical/10 text-status-critical border-status-critical/30 uppercase text-[10px] tracking-wider font-bold"
                  : severity === "warning"
                    ? "bg-status-warning/10 text-status-warning border-status-warning/30 uppercase text-[10px] tracking-wider font-bold"
                    : "bg-status-nominal/10 text-status-nominal border-status-nominal/30 uppercase text-[10px] tracking-wider font-bold"
              }
            >
              {severity}
            </Badge>
          );
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        enableColumnFilter: true,
        cell: ({ row }) => {
          const id = row.original._id;
          const status = optimisticStatusMap.get(id) ?? row.original.status;
          return (
            <Select
              value={status}
              onValueChange={(val) => {
                if (val) {
                  handleStatusChange(id, val as "ACTIVE" | "ACKNOWLEDGED" | "ESCALATED" | "FALSE_POSITIVE");
                }
              }}
            >
              <SelectTrigger size="sm" className="w-[140px] text-xs font-semibold">
                <SelectValue placeholder={status} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE" className="text-xs font-semibold">Active</SelectItem>
                <SelectItem value="ACKNOWLEDGED" className="text-xs font-semibold">Acknowledged</SelectItem>
                <SelectItem value="ESCALATED" className="text-xs font-semibold font-bold text-destructive">Escalated</SelectItem>
                <SelectItem value="FALSE_POSITIVE" className="text-xs font-semibold text-muted-foreground">False Positive</SelectItem>
              </SelectContent>
            </Select>
          );
        },
      },
    ],
    [camerasMap, optimisticStatusMap, handleStatusChange]
  );

  // Setup client side processing (filtering, sorting, pagination)
  const [searchQuery, setSearchQuery] = React.useState("");
  const [severityFilter, setSeverityFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");

  // Calculate filtered rows on the client
  const processedData = React.useMemo(() => {
    let result = allLogs || [];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (log) =>
          log.classification.toLowerCase().includes(query) ||
          (log.previewText || "").toLowerCase().includes(query) ||
          (camerasMap[log.cameraId] || log.cameraId).toLowerCase().includes(query)
      );
    }

    // Filter by severity
    if (severityFilter !== "all") {
      result = result.filter((log) => log.severity === severityFilter);
    }

    // Filter by status
    if (statusFilter !== "all") {
      result = result.filter((log) => log.status === statusFilter);
    }

    return result;
  }, [allLogs, searchQuery, severityFilter, statusFilter, camerasMap]);

  // Hook parameters & instantiation
  const pageSize = 10;
  const totalCount = processedData.length;
  const pageCount = Math.ceil(totalCount / pageSize);

  // Fetch useDataTable hook
  const { table } = useDataTable<ThreatLog>({
    columns,
    data: processedData, // Note: we pass full processed data, but we will slice it ourselves or let page index slice it
    pageCount,
    initialState: {
      pagination: {
        pageSize,
        pageIndex: 0,
      },
    },
  });

  const pagination = table.getState().pagination;
  const sorting = table.getState().sorting;

  // Apply sorting and slice for the current page
  const sortedAndPaginatedData = React.useMemo(() => {
    const sorted = [...processedData];

    // Apply sorting
    if (sorting.length > 0) {
      const { id, desc } = sorting[0];
      sorted.sort((a, b) => {
        let valA = a[id as keyof typeof a];
        let valB = b[id as keyof typeof b];

        if (id === "cameraId") {
          valA = camerasMap[a.cameraId] || a.cameraId;
          valB = camerasMap[b.cameraId] || b.cameraId;
        }

        if (valA === undefined || valA === null) return desc ? 1 : -1;
        if (valB === undefined || valB === null) return desc ? -1 : 1;

        if (valA < valB) return desc ? 1 : -1;
        if (valA > valB) return desc ? -1 : 1;
        return 0;
      });
    }

    // Paginate slice
    const startIndex = pagination.pageIndex * pagination.pageSize;
    const endIndex = startIndex + pagination.pageSize;
    return sorted.slice(startIndex, endIndex);
  }, [processedData, sorting, pagination, camerasMap]);

  // Client side CSV export
  const handleExport = () => {
    if (processedData.length === 0) {
      alert("No data available to export.");
      return;
    }

    const headers = [
      "Timestamp",
      "Camera Name",
      "Classification",
      "Confidence (%)",
      "Severity",
      "Status",
      "VLM Analysis Notes",
    ];

    const csvContent = [
      headers.join(","),
      ...processedData.map((log) => {
        const cameraName = camerasMap[log.cameraId] || log.cameraId;
        const vlmNotes = (log.vlmAnalysis || []).join(" | ").replace(/"/g, '""');
        return [
          log.timestamp,
          `"${cameraName.replace(/"/g, '""')}"`,
          `"${log.classification.replace(/"/g, '""')}"`,
          log.confidence,
          log.severity,
          log.status,
          `"${vlmNotes}"`,
        ].join(",");
      }),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `threat-logs-${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (allLogs === undefined) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-muted-foreground text-sm font-medium animate-pulse">
          Loading threat intelligence logs...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-status-critical" />
            Threat Log Audit
          </h3>
          <p className="text-sm text-muted-foreground font-light mt-1">
            Review security warning overrides, confidence levels, and VLM validation statuses.
          </p>
        </div>
        <Button onClick={handleExport} variant="outline" className="cursor-pointer gap-2 hover:bg-muted/50 border-border/60">
          <Download className="w-4 h-4" />
          Export CSV
        </Button>
      </div>

      <Separator className="bg-border/60" />

      {/* Filters Toolbar */}
      <div className="grid gap-4 sm:grid-cols-3 bg-muted/10 border border-border/40 p-4 rounded-xl backdrop-blur-xs">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search object, preview, or camera..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm border-border/50 bg-background/50"
          />
        </div>

        {/* Severity filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Severity</label>
          <Select value={severityFilter} onValueChange={(val) => setSeverityFilter(val ?? "all")}>
            <SelectTrigger size="sm" className="w-full text-xs font-semibold">
              <SelectValue placeholder="All Severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs font-semibold">All Severities</SelectItem>
              <SelectItem value="critical" className="text-xs font-semibold text-status-critical">Critical</SelectItem>
              <SelectItem value="warning" className="text-xs font-semibold text-status-warning">Warning</SelectItem>
              <SelectItem value="nominal" className="text-xs font-semibold text-status-nominal">Nominal</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Status</label>
          <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val ?? "all")}>
            <SelectTrigger size="sm" className="w-full text-xs font-semibold">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs font-semibold">All Statuses</SelectItem>
              <SelectItem value="ACTIVE" className="text-xs font-semibold">Active</SelectItem>
              <SelectItem value="ACKNOWLEDGED" className="text-xs font-semibold">Acknowledged</SelectItem>
              <SelectItem value="ESCALATED" className="text-xs font-semibold text-destructive">Escalated</SelectItem>
              <SelectItem value="FALSE_POSITIVE" className="text-xs font-semibold text-muted-foreground">False Positive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Table */}
      <Card className="border-border/50 bg-background/40 backdrop-blur-xs overflow-hidden shadow-xs">
        <CardHeader className="bg-muted/10 border-b border-border/30 py-4 px-6">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold">Surveillance Log Grid</CardTitle>
              <CardDescription className="text-xs font-light mt-0.5">
                Detailed metrics of vision loop classification events.
              </CardDescription>
            </div>
            <div className="text-xs font-mono text-muted-foreground bg-muted/20 px-2 py-0.5 rounded-sm">
              {totalCount} total record{totalCount !== 1 && "s"}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/5 border-b border-border/30">
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column.id}
                      onClick={() => {
                        const isSorted = sorting.find((s) => s.id === column.id);
                        table.setSorting([
                          {
                            id: column.id!,
                            desc: isSorted ? !isSorted.desc : false,
                          },
                        ]);
                      }}
                      className="cursor-pointer select-none py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        {column.header as string}
                        {sorting.find((s) => s.id === column.id) ? (
                          sorting.find((s) => s.id === column.id)?.desc ? (
                            <span className="text-[10px]">▼</span>
                          ) : (
                            <span className="text-[10px]">▲</span>
                          )
                        ) : null}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAndPaginatedData.length > 0 ? (
                  sortedAndPaginatedData.map((row) => (
                    <TableRow
                      key={row._id}
                      className="border-b border-border/30 hover:bg-muted/5 transition-colors duration-150"
                    >
                      <TableCell className="py-3 px-4 font-mono text-xs text-muted-foreground">
                        {new Date(row.timestamp).toLocaleDateString()}{" "}
                        {new Date(row.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="py-3 px-4 font-medium text-sm">
                        {camerasMap[row.cameraId] || row.cameraId}
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <div className="max-w-[240px]">
                          <div className="font-semibold text-foreground text-sm line-clamp-1">
                            {row.classification}
                          </div>
                          {row.previewText && (
                            <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5 font-light">
                              {row.previewText}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4 font-mono text-xs font-semibold">
                        {Math.round(row.confidence)}%
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <Badge
                          variant="outline"
                          className={
                            row.severity === "critical"
                              ? "bg-status-critical/10 text-status-critical border-status-critical/30 uppercase text-[10px] tracking-wider font-bold"
                              : row.severity === "warning"
                                ? "bg-status-warning/10 text-status-warning border-status-warning/30 uppercase text-[10px] tracking-wider font-bold"
                                : "bg-status-nominal/10 text-status-nominal border-status-nominal/30 uppercase text-[10px] tracking-wider font-bold"
                          }
                        >
                          {row.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <Select
                          value={optimisticStatusMap.get(row._id) ?? row.status}
                          onValueChange={(val) => {
                            if (val) {
                              handleStatusChange(row._id, val as "ACTIVE" | "ACKNOWLEDGED" | "ESCALATED" | "FALSE_POSITIVE");
                            }
                          }}
                        >
                          <SelectTrigger size="sm" className="w-[140px] text-xs font-semibold border-border/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ACTIVE" className="text-xs font-semibold">Active</SelectItem>
                            <SelectItem value="ACKNOWLEDGED" className="text-xs font-semibold">Acknowledged</SelectItem>
                            <SelectItem value="ESCALATED" className="text-xs font-semibold font-bold text-destructive">Escalated</SelectItem>
                            <SelectItem value="FALSE_POSITIVE" className="text-xs font-semibold text-muted-foreground">False Positive</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground font-light text-sm">
                      No threat logs match the active filter criteria.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination bar */}
          {totalCount > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between py-4 px-6 border-t border-border/30 gap-4 bg-muted/5">
              <div className="text-xs text-muted-foreground font-light">
                Showing <span className="font-semibold text-foreground">{pagination.pageIndex * pagination.pageSize + 1}</span> to{" "}
                <span className="font-semibold text-foreground">
                  {Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalCount)}
                </span> of <span className="font-semibold text-foreground">{totalCount}</span> events
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="cursor-pointer h-8 text-xs hover:bg-muted/50 border-border/60"
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Page <span className="font-semibold text-foreground">{pagination.pageIndex + 1}</span> of{" "}
                  <span className="font-semibold text-foreground">{Math.max(1, pageCount)}</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="cursor-pointer h-8 text-xs hover:bg-muted/50 border-border/60"
                >
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

export default function ThreatLogPage() {
  return (
    <React.Suspense fallback={
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-muted-foreground text-sm font-medium animate-pulse">
          Loading threat intelligence logs...
        </div>
      </div>
    }>
      <ThreatLogPageContent />
    </React.Suspense>
  );
}
