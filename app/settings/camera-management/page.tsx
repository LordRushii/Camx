"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Camera, Trash2, Edit2, Plus, RefreshCw, AlertCircle, CheckCircle, Info } from "lucide-react";
import { Doc, Id } from "@/convex/_generated/dataModel";

const cameraFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  location: z.string().min(2, "Location must be at least 2 characters."),
  zone: z.string().min(2, "Zone must be at least 2 characters."),
  sourceType: z.enum(["device", "network"]),
  sourceKey: z.string().min(1, "Source device/channel key is required."),
  sourceUrl: z.string(),
  enabled: z.boolean(),
});

type CameraFormValues = z.infer<typeof cameraFormSchema>;

export default function CameraManagementPage() {
  const cameras = useQuery(api.cameras.list);
  const upsertCamera = useMutation(api.cameras.upsert);
  const deleteCamera = useMutation(api.cameras.remove);

  const [editingCamera, setEditingCamera] = React.useState<Doc<"cameras"> | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const form = useForm<CameraFormValues>({
    resolver: zodResolver(cameraFormSchema),
    defaultValues: {
      name: "",
      location: "",
      zone: "",
      sourceType: "device",
      sourceKey: "0",
      sourceUrl: "",
      enabled: true,
    },
  });

  // Watch source type to show/hide connection URL helper
  const watchSourceType = form.watch("sourceType");

  // Load selected camera into form
  React.useEffect(() => {
    if (editingCamera) {
      form.reset({
        name: editingCamera.name,
        location: editingCamera.location,
        zone: editingCamera.zone,
        sourceType: editingCamera.sourceType,
        sourceKey: editingCamera.sourceKey,
        sourceUrl: editingCamera.sourceUrl || "",
        enabled: editingCamera.enabled,
      });
    } else {
      form.reset({
        name: "",
        location: "",
        zone: "",
        sourceType: "device",
        sourceKey: "0",
        sourceUrl: "",
        enabled: true,
      });
    }
  }, [editingCamera, form]);

  const handleEdit = (camera: Doc<"cameras">) => {
    setEditingCamera(camera);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleCancelEdit = () => {
    setEditingCamera(null);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleDelete = async (id: Id<"cameras">) => {
    if (!confirm("Are you sure you want to delete this camera? This action cannot be undone.")) {
      return;
    }

    try {
      await deleteCamera({ id });
      setSuccessMessage("Camera successfully removed from system.");
      if (editingCamera && editingCamera._id === id) {
        setEditingCamera(null);
      }
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete camera.");
    }
  };

  const handleToggleEnabled = async (camera: Doc<"cameras">) => {
    try {
      await upsertCamera({
        id: camera._id,
        cameraId: camera.cameraId,
        name: camera.name,
        location: camera.location,
        zone: camera.zone,
        sourceType: camera.sourceType,
        sourceKey: camera.sourceKey,
        sourceUrl: camera.sourceUrl,
        enabled: !camera.enabled,
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to toggle camera status.");
      setTimeout(() => setErrorMessage(null), 4000);
    }
  };

  const onSubmit = async (values: CameraFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const cameraId = editingCamera
        ? editingCamera.cameraId
        : `cam-${Date.now()}`;

      await upsertCamera({
        id: editingCamera?._id || undefined,
        cameraId,
        name: values.name,
        location: values.location,
        zone: values.zone,
        sourceType: values.sourceType,
        sourceKey: values.sourceKey,
        sourceUrl: values.sourceUrl,
        enabled: values.enabled,
      });

      setSuccessMessage(
        editingCamera
          ? "Camera configuration updated successfully."
          : "New camera stream registered successfully."
      );
      setEditingCamera(null);
      form.reset();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save camera configuration.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div>
        <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Camera className="w-5 h-5 text-primary" />
          Camera Management
        </h3>
        <p className="text-sm text-muted-foreground font-light mt-1">
          Register input camera devices, configure network RTSP feeds, and control active detection status.
        </p>
      </div>

      <Separator className="bg-border/60" />

      {/* Notifications */}
      {successMessage && (
        <div className="flex items-center gap-2.5 bg-status-nominal/10 text-status-nominal border border-status-nominal/30 rounded-xl p-4 text-sm font-semibold transition-all">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="flex items-center gap-2.5 bg-status-critical/10 text-status-critical border border-status-critical/30 rounded-xl p-4 text-sm font-semibold transition-all">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="grid gap-6 md:grid-cols-5">
        {/* Camera List - 3 cols */}
        <div className="md:col-span-3 space-y-4">
          <Card className="border-border/50 bg-background/40 backdrop-blur-xs shadow-xs">
            <CardHeader className="bg-muted/10 border-b border-border/30 py-4 px-6">
              <CardTitle className="text-sm font-bold">Configured Surveillance Inputs</CardTitle>
              <CardDescription className="text-xs font-light mt-0.5">
                All connected and configured vision system devices.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {cameras === undefined ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="text-muted-foreground text-xs font-medium animate-pulse flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Syncing camera hardware...
                  </div>
                </div>
              ) : cameras.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-border/40 rounded-xl bg-muted/5 p-6 text-center">
                  <Camera className="w-8 h-8 text-muted-foreground/50 mb-3" />
                  <p className="text-sm font-semibold text-muted-foreground">No cameras registered</p>
                  <p className="text-xs text-muted-foreground font-light mt-1">
                    Fill out the form to register your first local device or RTSP web feed.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {cameras.map((camera) => (
                    <div
                      key={camera._id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:bg-muted/10 hover:border-border/80 transition-all duration-150 gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{camera.name}</span>
                          <Badge
                            variant="outline"
                            className={
                              camera.enabled
                                ? "bg-status-nominal/10 text-status-nominal border-status-nominal/30 uppercase text-[9px] tracking-wider font-bold"
                                : "bg-muted/40 text-muted-foreground border-border uppercase text-[9px] tracking-wider font-bold"
                            }
                          >
                            {camera.enabled ? "Active" : "Disabled"}
                          </Badge>
                        </div>
                        <div className="text-xs font-light text-muted-foreground space-y-0.5">
                          <p>
                            <span className="font-semibold">Location:</span> {camera.location} &bull;{" "}
                            <span className="font-semibold">Zone:</span> {camera.zone}
                          </p>
                          <p className="font-mono text-[10px]">
                            {camera.sourceType === "device"
                              ? `Hardware Device ID: ${camera.sourceKey}`
                              : `RTSP URL: ${camera.sourceUrl}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                        {/* Enabled switch toggle */}
                        <div className="flex items-center gap-2 mr-1">
                          <span className="text-xs font-semibold text-muted-foreground">Grid Feed</span>
                          <Switch
                            checked={camera.enabled}
                            onCheckedChange={() => handleToggleEnabled(camera)}
                            size="sm"
                          />
                        </div>

                        {/* Edit Button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(camera)}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-muted"
                          title="Edit Configuration"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>

                        {/* Delete Button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(camera._id)}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive cursor-pointer hover:bg-destructive/10"
                          title="Remove Camera"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Camera Register/Edit Form - 2 cols */}
        <div className="md:col-span-2">
          <Card className="border-border/50 bg-background/40 backdrop-blur-xs shadow-xs sticky top-4">
            <CardHeader className="bg-muted/10 border-b border-border/30 py-4 px-6">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                {!editingCamera && <Plus className="w-4 h-4 text-primary" />}
                {editingCamera ? `Modify Configuration` : `Register Surveillance Input`}
              </CardTitle>
              <CardDescription className="text-xs font-light mt-0.5">
                {editingCamera
                  ? `Update configuration variables for the selected stream.`
                  : `Add new vision stream settings to compile logs.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {/* Alias Name */}
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">Camera Alias Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Back Garden Entrance" {...field} className="h-9 text-sm" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Location & Zone Row */}
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold">Location Label</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Backyard Gate" {...field} className="h-9 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="zone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold">Security Zone</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Perimeter" {...field} className="h-9 text-sm" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Source Type Selection */}
                  <FormField
                    control={form.control}
                    name="sourceType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">Source Connection Type</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={(val) => {
                            field.onChange(val);
                            // Auto adjust default source key
                            if (val === "device") {
                              form.setValue("sourceKey", "0");
                              form.setValue("sourceUrl", "");
                            } else {
                              form.setValue("sourceKey", "stream_0");
                            }
                          }}
                        >
                          <SelectTrigger className="w-full text-xs font-semibold h-9">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="device" className="text-xs font-semibold">Local Hardware Device</SelectItem>
                            <SelectItem value="network" className="text-xs font-semibold">Network RTSP Stream</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Source Key */}
                  <FormField
                    control={form.control}
                    name="sourceKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">
                          {watchSourceType === "device" ? "Local Device Index" : "Network Stream Alias Key"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={watchSourceType === "device" ? "e.g. 0 or 1" : "e.g. cam_front_rtsp"}
                            {...field}
                            className="h-9 text-sm font-mono"
                          />
                        </FormControl>
                        <FormDescription className="text-[10px] font-light leading-normal">
                          {watchSourceType === "device"
                            ? "USB webcam or integrated camera index (usually 0, 1, or 2)."
                            : "Unique alphanumeric string identifier for this stream key."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Source Connection URL (RTSP) - only shown for network streams */}
                  {watchSourceType === "network" && (
                    <FormField
                      control={form.control}
                      name="sourceUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold">Network RTSP URL</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="rtsp://admin:password@192.168.1.100:554/stream1"
                              {...field}
                              className="h-9 text-sm font-mono text-xs"
                            />
                          </FormControl>
                          <FormDescription className="text-[10px] font-light leading-normal flex items-start gap-1">
                            <Info className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                            Specify the credentials and address of your IP camera feed.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* Enabled switch toggle inside form */}
                  <FormField
                    control={form.control}
                    name="enabled"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between border border-border/30 bg-muted/10 p-3 rounded-xl gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-xs font-semibold">Enable Live Processing</FormLabel>
                          <FormDescription className="text-[10px] font-light leading-normal">
                            Activate YOLO / VLM evaluation immediately on this feed.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {/* Submit buttons */}
                  <div className="flex gap-2 pt-2">
                    {editingCamera && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancelEdit}
                        className="flex-1 cursor-pointer h-9 text-sm border-border/60"
                      >
                        Cancel
                      </Button>
                    )}
                    <Button type="submit" className="flex-1 cursor-pointer h-9 text-sm font-semibold">
                      {editingCamera ? "Save Changes" : "Register Camera"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
