"use client";

export default function FilterBar({
  categoryFilter,
  siteFilter,
  examTypeFilter,
  categoryOptions,
  siteOptions,
  examTypeOptions,
  onCategoryChange,
  onSiteChange,
  onExamTypeChange,
  onClear
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Filters</h3>
          <p className="text-xs text-slate-500">Filter schedules by category, exam center, and exam type.</p>
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
        <FilterSelect label="Category" value={categoryFilter} onChange={onCategoryChange} options={categoryOptions} allLabel="All categories" prefix="Category" />
        <FilterSelect label="Center" value={siteFilter} onChange={onSiteChange} options={siteOptions} allLabel="All centers" />
        <FilterSelect label="Exam type" value={examTypeFilter} onChange={onExamTypeChange} options={examTypeOptions} allLabel="All exam types" />
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
