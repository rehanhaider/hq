import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/** The title search above the page list and the trash. */
export function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="relative m-3 block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search pages"
        className="pl-8"
      />
    </label>
  );
}
