"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export default function AlertConfigurationPage() {
  const [webhookUrl, setWebhookUrl] = useState("https://discord.com/api/webhooks/mock-id");
  const [desktopAlerts, setDesktopAlerts] = useState(true);
  const [soundAlarms, setSoundAlarms] = useState(false);

  const handleSave = () => {
    alert("Alert configurations saved successfully!");
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Alert Configuration</h3>
        <p className="text-sm text-muted-foreground">
          Setup notification targets and system alarm sound behavior.
        </p>
      </div>
      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Broadcast Alerts</CardTitle>
          <CardDescription>
            Configure webhook URLs to broadcast verified security threat payloads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Discord/Telegram Webhook */}
          <div className="space-y-2">
            <label htmlFor="webhook-input" className="text-sm font-medium">
              Discord Webhook URL
            </label>
            <Input
              id="webhook-input"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="e.g. https://discord.com/api/webhooks/..."
            />
            <p className="text-xs text-muted-foreground">
              Receives a detailed JSON body including camera screenshots and VLM logs.
            </p>
          </div>

          <Separator />

          {/* Local Alerts */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Local Alerts</h4>
            <div className="space-y-4">
              {/* Desktop alerts toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium block">Desktop Push Notifications</span>
                  <span className="text-xs text-muted-foreground font-light">
                    Display notification cards inside the operating system.
                  </span>
                </div>
                <Button
                  variant={desktopAlerts ? "default" : "outline"}
                  onClick={() => setDesktopAlerts(!desktopAlerts)}
                  className="cursor-pointer"
                >
                  {desktopAlerts ? "Enabled" : "Disabled"}
                </Button>
              </div>

              {/* Sound alarm toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium block">Local Audible Alarm</span>
                  <span className="text-xs text-muted-foreground font-light">
                    Play a high-pitch tone on the server machine when a threat is verified.
                  </span>
                </div>
                <Button
                  variant={soundAlarms ? "default" : "outline"}
                  onClick={() => setSoundAlarms(!soundAlarms)}
                  className="cursor-pointer"
                >
                  {soundAlarms ? "Enabled" : "Disabled"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button onClick={handleSave} className="cursor-pointer">
            Save Configuration
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
