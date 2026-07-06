"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

interface ChatMessage {
  sender: "user" | "ai";
  text: string;
  timestamp: string;
  frameRef?: string;
}

export default function VideoQueryPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { sender: "ai", text: "Hello! I have loaded the timeline for `test-footage.mp4`. You can ask questions about moving objects, time events, or potential threats.", timestamp: "22:48:00" },
    { sender: "user", text: "When did the first person enter the building?", timestamp: "22:48:30" },
    { sender: "ai", text: "The first person enters the camera frame at 00:12:45 of the video clip, carrying a black backpack. They walk from right to left toward the lobby receptionist area.", timestamp: "22:48:32", frameRef: "frame-000150.jpg" },
  ]);

  const [inputText, setInputText] = useState("");

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userMsg: ChatMessage = {
      sender: "user",
      text: inputText,
      timestamp: new Date().toTimeString().split(" ")[0],
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");

    // Simulate AI response
    setTimeout(() => {
      const aiMsg: ChatMessage = {
        sender: "ai",
        text: "Based on the analyzed timeline, I did not observe any other occurrences matching that action. However, the camera 2 feed recorded a similar subject exiting the corridor at 00:15:30.",
        timestamp: new Date().toTimeString().split(" ")[0],
        frameRef: "frame-000210.jpg",
      };
      setMessages((prev) => [...prev, aiMsg]);
    }, 1000);
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Footage Q&A Chat</h2>
        <p className="text-sm text-muted-foreground">
          Query analyzed events, object sequences, and timeline tags using natural language.
        </p>
      </div>
      <Separator />

      <div className="grid gap-6 md:grid-cols-4 h-[calc(100vh-12rem)] min-h-0">
        {/* Left col: Sessions list */}
        <div className="md:col-span-1 border border-border rounded-lg bg-background flex flex-col p-4 space-y-4 overflow-y-auto">
          <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Analyzed Footage</h3>
          <div className="space-y-2">
            <button className="w-full text-left text-xs p-3 rounded-lg border border-border bg-secondary font-medium truncate cursor-pointer block">
              🎥 test-footage.mp4
              <span className="block font-normal text-xxs text-muted-foreground mt-1">Analyzed 10 mins ago</span>
            </button>
            <button className="w-full text-left text-xs p-3 rounded-lg border border-border bg-background hover:bg-muted/10 font-medium truncate cursor-not-allowed opacity-50 block" disabled>
              🎥 main-gate-recording.mp4
              <span className="block font-normal text-xxs text-muted-foreground mt-1">Archived 2 days ago</span>
            </button>
          </div>
        </div>

        {/* Right 3 cols: Chat window */}
        <div className="md:col-span-3 border border-border rounded-lg bg-background flex flex-col min-h-0 overflow-hidden">
          {/* Chat header */}
          <div className="p-4 border-b border-border bg-muted/10 flex items-center justify-between">
            <span className="text-xs font-semibold">Active Session: test-footage.mp4</span>
            <span className="text-xxs text-status-nominal font-mono">Index Connected</span>
          </div>

          {/* Conversation view */}
          <div className="flex-1 p-6 overflow-y-auto space-y-4">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex flex-col gap-1 max-w-[80%] ${
                  msg.sender === "user" ? "ml-auto items-end" : "mr-auto items-start"
                }`}
              >
                <div
                  className={`p-3 rounded-lg text-xs leading-relaxed ${
                    msg.sender === "user"
                      ? "bg-primary text-primary-foreground rounded-br-none"
                      : "bg-muted text-foreground rounded-bl-none border border-border/40"
                  }`}
                >
                  {msg.text}
                </div>
                {msg.frameRef && (
                  <div className="mt-1.5 p-2 rounded-md border border-border bg-muted/40 flex items-center gap-2 cursor-pointer hover:bg-muted/80 transition-colors">
                    <span className="text-xxs">🖼️</span>
                    <span className="text-xxs font-mono font-semibold text-primary underline">
                      {msg.frameRef}
                    </span>
                    <span className="text-xxs text-muted-foreground">(Jump to frame)</span>
                  </div>
                )}
                <span className="text-xxs text-muted-foreground">{msg.timestamp}</span>
              </div>
            ))}
          </div>

          {/* Input box */}
          <form onSubmit={handleSendMessage} className="p-4 border-t border-border bg-muted/10 flex gap-2">
            <Input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask about visible objects (e.g. 'What was the person carrying?')"
              className="flex-1 bg-background"
            />
            <Button type="submit" className="cursor-pointer">
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
