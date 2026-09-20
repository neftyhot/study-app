"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { dismissConflict, resolveConflict } from "@/lib/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export type ConflictView = {
  id: string;
  topic: string | null;
  statementA: string;
  statementB: string;
  explanation: string;
  resolution: string | null;
  dismissed: boolean;
  sourceA: string;
  sourceB: string;
};

export function ConflictCard({ conflict }: { conflict: ConflictView }) {
  const [pending, startTransition] = useTransition();
  const [resolution, setResolution] = useState(conflict.resolution ?? "");
  const settled = conflict.dismissed || Boolean(conflict.resolution);

  function save() {
    startTransition(async () => {
      await resolveConflict(conflict.id, resolution);
      toast.success("Saved your note on this conflict");
    });
  }

  function setDismissed(dismissed: boolean) {
    startTransition(async () => {
      await dismissConflict(conflict.id, dismissed);
    });
  }

  return (
    <Card className={settled ? "opacity-70" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 shrink-0" />
          {conflict.topic || "Contradiction across files"}
          {conflict.dismissed ? (
            <Badge variant="outline">dismissed</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{conflict.explanation}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Side source={conflict.sourceA} statement={conflict.statementA} />
          <Side source={conflict.sourceB} statement={conflict.statementB} />
        </div>

        <div className="space-y-2">
          <Textarea
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            placeholder="Which source is right, and why? (ask your professor if unsure)"
            className="min-h-16 text-sm"
            disabled={pending}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={pending}>
              Save decision
            </Button>
            {conflict.dismissed ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed(false)}
                disabled={pending}
              >
                <Undo2 className="size-3.5" />
                Undismiss
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed(true)}
                disabled={pending}
              >
                Not a conflict
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Side({ source, statement }: { source: string; statement: string }) {
  return (
    <div className="bg-muted/50 space-y-1 rounded p-2">
      <p className="text-xs font-medium">{source}</p>
      <blockquote className="text-muted-foreground border-l-2 pl-2 text-xs italic">
        {statement}
      </blockquote>
    </div>
  );
}
