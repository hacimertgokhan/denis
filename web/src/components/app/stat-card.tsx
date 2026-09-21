import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export function StatCard({
  label,
  value,
  hint,
  progress,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  /** 0-100 to show a quota bar. */
  progress?: number;
  badge?: string;
}) {
  const warn = progress !== undefined && progress >= 80;
  return (
    <Card className="@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {badge && (
          <CardAction>
            <Badge variant={warn ? "destructive" : "outline"}>{badge}</Badge>
          </CardAction>
        )}
      </CardHeader>
      {(hint || progress !== undefined) && (
        <CardFooter className="flex-col items-start gap-2 text-sm">
          {progress !== undefined && <Progress value={progress} className={warn ? "[&>div]:bg-destructive" : ""} />}
          {hint && <div className="text-muted-foreground">{hint}</div>}
        </CardFooter>
      )}
    </Card>
  );
}
