import * as Icons from "lucide-react";
import type { LucideProps } from "lucide-react";

type Props = LucideProps & {
  name: string;
};

export function DynamicIcon({ name, ...props }: Props) {
  const Icon = (Icons as any)[name] || Icons.AlertTriangle;
  return <Icon {...props} strokeWidth={2.2} />;
}
