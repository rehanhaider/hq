import {
  column_getCanSort,
  column_getIsSorted,
  column_getToggleSortingHandler,
} from "@tanstack/react-table/static-functions";
import type { ReactNode } from "react";
import type { ReactTable, RowData, TableFeatures } from "@tanstack/react-table";
import { cn } from "cn";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function columnClass(meta: unknown) {
  if (
    meta &&
    typeof meta === "object" &&
    "className" in meta &&
    typeof meta.className === "string"
  ) {
    return meta.className;
  }
}

export function DataTable<
  TFeatures extends TableFeatures,
  TData extends RowData,
>({
  table,
  empty,
}: {
  table: ReactTable<TFeatures, TData>;
  empty?: ReactNode;
}) {
  const rows = table.getRowModel().rows;
  return (
    <>
      <Table className="text-left text-xs">
        <TableHeader className="bg-muted/40">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  aria-sort={
                    column_getIsSorted(header.column) === "asc"
                      ? "ascending"
                      : column_getIsSorted(header.column) === "desc"
                        ? "descending"
                        : undefined
                  }
                  className={cn(
                    "h-auto px-3 py-2.5 font-normal text-muted-foreground first:px-5 last:px-5",
                    columnClass(header.column.columnDef.meta),
                  )}
                >
                  {header.isPlaceholder ? null : column_getCanSort(
                      header.column,
                    ) ? (
                    <button
                      className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap hover:text-foreground"
                      onClick={column_getToggleSortingHandler(header.column)}
                    >
                      <table.FlexRender header={header} />
                      <span aria-hidden>
                        {column_getIsSorted(header.column) === "asc"
                          ? "↑"
                          : column_getIsSorted(header.column) === "desc"
                            ? "↓"
                            : "↕"}
                      </span>
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="align-top hover:bg-muted/30">
              {row.getAllCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cn(
                    "px-3 py-3 whitespace-normal first:px-5 last:px-5",
                    columnClass(cell.column.columnDef.meta),
                  )}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!rows.length ? empty : null}
    </>
  );
}
