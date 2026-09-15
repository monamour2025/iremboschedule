"use client";

import { SYSTEM_EXAM_CENTER } from "@/lib/examCenters";

export default function FilterBar({
  categoryFilter,
  examTypeFilter,
  categoryOptions,
  examTypeOptions,
  onCategoryChange,
  onExamTypeChange,
  onClear
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Filters</h3>
          <p className="text-xs text-slate-500">
            This monitor only tracks {SYSTEM_EXAM_CENTER}. Filter by category and exam type.
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-medium text-teal-700 hover:text-teal-800"
        >
          Clear all
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <FilterSelect
          label="Category"
          value={categoryFilter}
          onChange={onCategoryChange}
          options={categoryOptions}
          allLabel="All categories"
          prefix="Category"
        />
        <label className="text-sm font-medium text-slate-700">
          Center
          <input
            readOnly
            value={SYSTEM_EXAM_CENTER}
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 text-sm text-slate-700"
          />
        </label>
        <FilterSelect
          label="Exam type"
          value={examTypeFilter}
          onChange={onExamTypeChange}
          options={examTypeOptions}
          allLabel="All exam types"
        />
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, allLabel, prefix }) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-700"
      >
        <option value="all">{allLabel}</option>
        {options
          .filter((option) => option !== "all")
          .map((option) => (
            <option key={option} value={option}>
              {prefix ? `${prefix} ${option}` : option}
            </option>
          ))}
      </select>
    </label>
  );
}
