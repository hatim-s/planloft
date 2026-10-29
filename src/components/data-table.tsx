import {
  constructTable,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import type { ReactNode } from "react";
import { Badge, BADGE_COLORS, isBadgeColor, type BadgeColor } from "./badge.js";
import { Status, STATUS_TONES, type StatusTone } from "./figures.js";
import {
  columnLabel,
  ComponentInputError,
  resolveFormatting,
  numericCell,
  requireKeys,
  requireRows,
  sumNumeric,
  textCell,
  type NumberFormat,
  type Row,
} from "./data.js";

export interface DataTableColumn {
  key: string;
  label?: string;
  /**
   * Numbers are right-aligned and formatted; text columns are left as written.
   * `status` shows a Status marker for "Done", "On track", "At risk", "Blocked" or "Not started".
   * `badge` shows each value as a Badge, coloured by `colors`.
   */
  format?: NumberFormat | "text" | "status" | "badge";
  /** Badge colour per cell value for `format="badge"`, as in `{ Web: "blue" }`. Unlisted values are gray. */
  colors?: Readonly<Record<string, BadgeColor>>;
  currency?: string;
  unit?: string;
}

export interface DataTableProps {
  data: readonly Row[];
  /** Column keys, or column settings. Defaults to every key of the first row. */
  columns?: readonly (string | DataTableColumn)[];
  /** Sort by a column key; prefix with "-" for descending, as in "-revenue". */
  sort?: string;
  /** Add a closing row with the sum of every numeric column. */
  totals?: boolean;
  caption?: ReactNode;
}

const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});
const helper = createColumnHelper<typeof features, Row>();

interface ResolvedColumn {
  key: string;
  label: string;
  numeric: boolean;
  marker: "status" | "badge" | null;
  colors: Readonly<Record<string, BadgeColor>>;
  format: (value: number) => string;
}

/** A static table: TanStack Table orders the rows, the markup stays plain HTML. */
export function DataTable({ data, columns, sort, totals = false, caption }: DataTableProps) {
  const rows = requireRows("DataTable", data);
  const resolved = resolveColumns(rows, columns);
  requireKeys("DataTable", rows, resolved.map((column) => column.key));

  const sortKey = sort?.replace(/^-/, "");
  if (sortKey && !resolved.some((column) => column.key === sortKey)) {
    throw new ComponentInputError("DataTable", `sorts by "${sortKey}", which is not one of its columns.`);
  }
  const table = constructTable({
    features,
    data: [...rows],
    columns: helper.columns(
      resolved.map((column) =>
        helper.accessor((row) => (column.numeric ? (numericCell(row, column.key) ?? undefined) : textCell(row, column.key)), {
          id: column.key,
          header: column.label,
          sortFn: column.numeric ? "basic" : "alphanumeric",
          sortUndefined: "last",
        }),
      ),
    ),
    initialState: { sorting: sortKey ? [{ id: sortKey, desc: sort!.startsWith("-") }] : [] },
  });
  const [first, ...rest] = resolved;

  return (
    <figure className="pl-table">
      <div className="pl-scroll">
        <table>
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {resolved.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.numeric ? "pl-num" : undefined}
                  aria-sort={column.key === sortKey ? (sort!.startsWith("-") ? "descending" : "ascending") : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {resolved.map((column, index) => {
                  const content = renderCell(row.original, column);
                  return index === 0
                    ? <th key={column.key} scope="row" className={column.numeric ? "pl-num" : undefined}>{content}</th>
                    : <td key={column.key} className={column.numeric ? "pl-num" : undefined}>{content}</td>;
                })}
              </tr>
            ))}
          </tbody>
          {totals && first ? (
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                {rest.map((column) => (
                  <td key={column.key} className={column.numeric ? "pl-num" : undefined}>
                    {column.numeric ? formatTotal(rows, column) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </figure>
  );
}

function formatTotal(rows: readonly Row[], column: ResolvedColumn): string {
  const total = sumNumeric(rows.map((row) => numericCell(row, column.key)));
  return total === null ? "—" : column.format(total);
}

function renderCell(row: Row, column: ResolvedColumn): ReactNode {
  if (column.marker === "status") {
    const text = textCell(row, column.key);
    const tone = text.trim().toLowerCase().replace(/\s+/g, "-");
    return isStatusTone(tone) ? <Status tone={tone}>{text}</Status> : text;
  }
  if (column.marker === "badge") {
    const text = textCell(row, column.key);
    return text.trim() === "" ? text : <Badge color={Object.hasOwn(column.colors, text) ? column.colors[text] : "gray"}>{text}</Badge>;
  }
  if (!column.numeric) return textCell(row, column.key);
  const value = numericCell(row, column.key);
  return value === null ? "—" : column.format(value);
}

function resolveColumns(rows: readonly Row[], columns: DataTableProps["columns"]): ResolvedColumn[] {
  const specs = (columns ?? Object.keys(rows[0]!)).map((column) => (typeof column === "string" ? { key: column } : column));
  return specs.map((spec) => {
    const { format } = spec;
    const marker = format === "status" || format === "badge" ? format : null;
    const numberFormat = format === "text" || format === "status" || format === "badge" ? undefined : format;
    const colors = spec.colors ?? {};
    if (!Object.values(colors).every(isBadgeColor)) {
      throw new ComponentInputError("DataTable", `column colors must be one of ${BADGE_COLORS.join(", ")}.`);
    }
    // A column is numeric when it is declared so, or when every filled cell is a number.
    const numeric = format
      ? numberFormat !== undefined
      : rows.every((row) => {
        const value = row[spec.key];
        return value == null || typeof value === "number" || (typeof value === "string" && value.trim() === "");
      });
    return {
      key: spec.key,
      label: spec.label ?? columnLabel(spec.key, undefined),
      numeric,
      marker,
      colors,
      format: resolveFormatting("DataTable", {
        format: numberFormat,
        currency: spec.currency,
        unit: spec.unit,
      }).table,
    };
  });
}

function isStatusTone(value: string): value is StatusTone {
  return STATUS_TONES.some((tone) => tone === value);
}
