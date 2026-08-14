import type { ReactNode } from "react";

type Props = {
  title: string;
  hint?: ReactNode;
};

export function LeftPanelEmpty({ title, hint }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-sm font-medium text-foreground/80">{title}</p>
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
