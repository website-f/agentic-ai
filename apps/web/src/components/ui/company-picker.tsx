/**
 * P111: one company picker for the whole office.
 *
 * Fitri (17 Nov 2026): "the dropdown company make it i can search and multi select as well ...
 * check for other select dropdown for company make it can search multi select style".
 *
 * - `multiple` (a form field that means several companies): chips with their own remove
 *   buttons, a list that stays open while you tick, search, "Pick all" / "Clear", Done.
 * - `multiple` + `filter` (a list filter): one compact button ("All companies", the one
 *   picked, or "3 picked") with the same list; nothing picked means all.
 * - single (only one company is valid): a button with a searchable list.
 *
 * All three type to filter (accents and case ignored), move with the arrows, pick with Enter,
 * close with Escape, and open as a bottom sheet on a phone (search-select.tsx). The companies
 * are the ones the API lists for this person (/api/branches) unless the screen passes its own
 * (e.g. only the companies a scoped manager may use). `before` adds choices listed first,
 * such as "No company" or "Every company".
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useT } from "@/i18n";
import { branchesQuery } from "@/lib/queries";

import { MultiFilter, MultiSelect, SearchSelect, type PickOption } from "./search-select";

export interface CompanyLike {
  id: string;
  name: string;
  slug?: string;
}

/** Companies as picker options: the name, found by its short name (slug) too. */
export function companyOptions(companies: CompanyLike[]): PickOption[] {
  return companies.map((b) => ({ value: b.id, label: b.name, keywords: b.slug ? [b.slug] : undefined }));
}

interface Base {
  /** The field's name (accessible name, sheet title). Default "Company" / "Companies". */
  label?: string;
  /** Default: every company the API lists for this person. */
  companies?: CompanyLike[];
  /** Choices listed before the companies ("No company", "Every company"). */
  before?: PickOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
}

type Single = Base & {
  multiple?: false;
  filter?: false;
  value: string;
  onValueChange: (value: string) => void;
};

type Many = Base & {
  multiple: true;
  filter?: false;
  value: string[];
  onValueChange: (value: string[]) => void;
  /** Chips shown before "+N more". */
  maxChips?: number;
};

type Filter = Base & {
  multiple: true;
  filter: true;
  value: string[];
  onValueChange: (value: string[]) => void;
  /** What it reads with nothing picked. Default "All companies". */
  allLabel?: string;
};

export type CompanyPickerProps = Single | Many | Filter;

export function CompanyPicker(props: CompanyPickerProps) {
  const t = useT();
  const { data: listed = [] } = useQuery({ ...branchesQuery, enabled: !props.companies });
  const companies = props.companies ?? listed;
  const options = useMemo(() => [...(props.before ?? []), ...companyOptions(companies)], [props.before, companies]);
  const common = {
    options,
    disabled: props.disabled,
    size: props.size,
    className: props.className,
    id: props.id,
    searchPlaceholder: t("Search companies"),
    emptyText: t("No company matches."),
  };
  if (props.multiple && props.filter) {
    return <MultiFilter {...common} label={props.label ?? t("Company")} allLabel={props.allLabel ?? t("All companies")}
      value={props.value} onValueChange={props.onValueChange} />;
  }
  if (props.multiple) {
    return <MultiSelect {...common} label={props.label ?? t("Companies")} placeholder={props.placeholder ?? t("Pick companies")}
      value={props.value} onValueChange={props.onValueChange} maxChips={props.maxChips} />;
  }
  return <SearchSelect {...common} label={props.label ?? t("Company")} placeholder={props.placeholder ?? t("Pick a company")}
    value={props.value} onValueChange={props.onValueChange} />;
}
