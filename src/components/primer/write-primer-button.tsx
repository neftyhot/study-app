"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { writePrimer } from "@/lib/primer/actions";

export function WritePrimerButton({
  examId,
  depth,
  rewrite,
}: {
  examId: string;
  depth: string;
  rewrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant={rewrite ? "outline" : "default"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await writePrimer(examId, depth);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(rewrite ? "Study guide rewritten." : "Study guide ready.");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {pending ? "Writing…" : rewrite ? "Rewrite" : "Write primer"}
    </Button>
  );
}
