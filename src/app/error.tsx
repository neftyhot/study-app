"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The error boundary a student actually lands on.
 *
 * It shows the real message rather than "something went wrong": most failures
 * here are actionable — a missing API key, an unreadable upload — and hiding
 * which one it was just means they cannot fix it.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TriangleAlert className="size-4" />
          That did not work
        </CardTitle>
        <CardDescription className="break-words">
          {error.message || "An unexpected error occurred."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={reset}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
        {error.digest ? (
          <p className="text-muted-foreground font-mono text-xs">
            {error.digest}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
