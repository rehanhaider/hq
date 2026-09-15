import { Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { statusQuery } from "@/queries/dashboard";

/** Every GitHub view sits under the import status, when there is any. */
export function GithubLayout() {
  const status = useQuery(statusQuery);
  const importing = status.data?.state === "running";
  return (
    <div className="space-y-5">
      {status.data &&
        status.data.state !== "idle" &&
        status.data.state !== "complete" && (
          <div
            className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-xs ${status.data.state === "error" ? "border-negative/30 bg-negative/5" : "bg-card"}`}
            role={status.data.state === "error" ? "alert" : "status"}
          >
            {importing ? (
              <RefreshCw className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : status.data.state === "error" ? (
              <CircleAlert className="size-4 shrink-0 text-negative" />
            ) : (
              <Check className="size-4 shrink-0 text-positive" />
            )}
            <span className="min-w-0 flex-1 break-words">
              {status.data.message}
            </span>
            <span className="font-mono text-muted-foreground">
              {status.data.completed}/{status.data.total}
            </span>
            {importing && (
              <Progress
                aria-label="Repositories imported"
                value={
                  status.data.total
                    ? (status.data.completed / status.data.total) * 100
                    : 0
                }
                className="w-24"
              />
            )}
          </div>
        )}
      <Outlet />
    </div>
  );
}
