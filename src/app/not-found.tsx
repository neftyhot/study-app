import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NotFound() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Not found</CardTitle>
        <CardDescription>
          This course or deck does not exist — it may have been deleted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/">Back to subjects</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
