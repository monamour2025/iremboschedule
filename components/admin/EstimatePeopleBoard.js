"use client";

export function estimateProgress(applicant) {
  const status = String(applicant?.status || "");
  const created = ["APPLICATION_CREATED", "COMPLETED", "PAYMENT_PENDING", "PAID"].includes(status);
  if (created) {
    return {
      key: "created",
      label: `Code: ${applicant.applicationNumber || "Created"}`,
      detail: applicant.applicationNumber || "Application code ready"
    };
  }
  if (status.startsWith("FAILED") || status === "ALREADY_REGISTERED") {
    return {
      key: "failed",
      label: "Application rejected",
      detail: applicant.lastError || "Irembo could not process this application"
    };
  }
  if (applicant?.searchPaused) {
    return {
      key: "paused",
      label: "Paused",
      detail: applicant.lastError || "Search paused"
    };
  }
  if (
    status === "PENDING" ||
    status === "RESERVING_SLOT" ||
    status === "SLOT_RESERVED" ||
    status === "LICENSE_VALIDATED" ||
    status === "RUNNING"
  ) {
    return {
      key: "creating",
      label: "Submitting to Irembo...",
      detail: applicant.lastError || "Booking slot on Irembo..."
    };
  }
  return {
    key: "waiting",
    label: "Not applied yet",
    detail: ""
  };
}

export default function EstimatePeopleBoard({
  applicants = [],
  onRefresh,
  onRemove,
  onRetry,
  onEditCategory,
  onCreateOne,
  creatingId,
  editingId,
  onCancelEdit,
  title = "Queue",
  description,
  emptyMessage = "No one in the queue yet. Add people on the Estimate list.",
  categoryOptions = ["A", "A1", "B", "B(AT)", "B1", "C", "D", "D1", "E", "F"]
}) {
  const people = Array.isArray(applicants) ? applicants : [];

  return (
    <section id="people" className="animate-fade-up rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">
            {description || `${people.length} people \u00b7 click Create Application to book immediately on Irembo`}
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Refresh
          </button>
        ) : null}
      </div>

      {people.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="grid gap-3">
          {people.map((applicant) => {
            const progress = estimateProgress(applicant);
            const category =
              applicant.requestedLicenseCategory || applicant.licenseCategory || "\u2014";
            const isCreatingThis = creatingId === applicant.id || progress.key === "creating";
            const isDone = progress.key === "created";
            const canCreate = onCreateOne && !isDone && !isCreatingThis;

            return (
              <article
                key={applicant.id}
                className={`rounded-xl border p-4 transition ${
                  isDone
                    ? "border-emerald-200 bg-emerald-50/30"
                    : progress.key === "failed"
                      ? "border-red-200 bg-red-50/20"
                      : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-base font-bold text-slate-950">{applicant.fullName}</p>
                      {isDone ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
                          ✓ {progress.label}
                        </span>
                      ) : isCreatingThis ? (
                        <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-200 animate-pulse">
                          ⚡ Submitting to Irembo...
                        </span>
                      ) : progress.key === "failed" ? (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-900 ring-1 ring-red-200">
                          ✕ Rejected
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="font-semibold text-slate-800">Category {category}</span>
                      {applicant.phone ? ` \u00b7 ${applicant.phone}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Big direct Create Application button */}
                    {canCreate ? (
                      <button
                        type="button"
                        onClick={() => onCreateOne(applicant)}
                        className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition"
                        title={`Book Category ${category} immediately on Irembo`}
                      >
                        ⚡ Create Application
                      </button>
                    ) : null}

                    {isCreatingThis ? (
                      <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 ring-1 ring-amber-200 animate-pulse">
                        Booking in progress\u2026
                      </span>
                    ) : null}

                    {onRetry && (progress.key === "failed" || progress.key === "paused") ? (
                      <button
                        type="button"
                        onClick={() => onRetry(applicant)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Retry
                      </button>
                    ) : null}

                    {onEditCategory && editingId !== applicant.id ? (
                      <button
                        type="button"
                        onClick={() => onEditCategory(applicant, null)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                    ) : null}

                    {onRemove ? (
                      <button
                        type="button"
                        onClick={() => onRemove(applicant)}
                        className="px-2 py-1 text-xs text-slate-400 hover:text-red-600"
                        title="Remove applicant"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>

                {onEditCategory && editingId === applicant.id ? (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const cat = event.currentTarget.category.value;
                      const phone = event.currentTarget.phone.value;
                      onEditCategory(applicant, { category: cat, phone });
                    }}
                  >
                    <label className="text-xs font-medium text-slate-700">
                      Category
                      <select
                        name="category"
                        defaultValue={String(category).toUpperCase()}
                        className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                      >
                        {categoryOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-700">
                      Phone
                      <input
                        name="phone"
                        type="tel"
                        defaultValue={applicant.phone || ""}
                        className="mt-1 block w-40 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      Save
                    </button>
                    {onCancelEdit ? (
                      <button
                        type="button"
                        onClick={onCancelEdit}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </form>
                ) : null}

                {/* If Application Code is created, show prominent code card */}
                {isDone && applicant.applicationNumber ? (
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-sm text-emerald-900">
                    <div>
                      <span className="text-xs uppercase tracking-wide font-semibold text-emerald-700">Application Number</span>
                      <p className="font-mono text-base font-bold text-emerald-950">{applicant.applicationNumber}</p>
                    </div>
                    {applicant.applications?.[0]?.amount ? (
                      <span className="text-xs font-semibold text-emerald-800">
                        {applicant.applications[0].amount} RWF
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* If Irembo returned an error/rejection, show it clearly */}
                {progress.key === "failed" || progress.key === "paused" ? (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                    <p className="font-bold text-red-950">⚠️ Irembo Rejection:</p>
                    <p className="mt-0.5 font-mono text-red-800 leading-relaxed">{progress.detail}</p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
