"use client";

import { use } from "react";
import { QueryChatView } from "@/components/QueryView";
import type { Id } from "@convex/_generated/dataModel";

export default function QueryChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = use(params);
  return <QueryChatView chatId={chatId as Id<"queryChats">} />;
}
