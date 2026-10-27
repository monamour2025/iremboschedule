"use client";

export function estimateProgress(applicant) {
  const status = String(applicant?.status || "");
  const created = ["APPLICATION_CREATED", "COMPLETED", "PAYMENT_PENDING", "PAID"].includes(status);
  if (created) {
    return {
      step: 3,
      key: "created",
      label: "Application created",
      detail: applicant.applicationNumber || "Application code ready"
    };
  }
  if (status.startsWith("FAILED") || status === "ALREADY_REGISTERED") {
    return {
      step: 2,
      key: "failed",
      label: "Application rejected",
      detail: applicant.lastError || "Irembo could not process this application"
    };
  }
  if (applicant?.searchPaused) {
    return {
      step: 2,
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
      step: 2,
      key: "creating",
      label: "Creating application...",
      detail: applicant.lastError || "Reserving seat and submitting to Irembo..."
    };
  }
  return {
    step: 2,
    key: "ready",
    label: "Ready to Apply",
    detail: "Click 'Create Application' to submit to Irembo"
  };
}

function StepIcon({ done, current, kind }) {
  if (kind === "failed") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white shadow-sm font-bold text-xs">
        ✕
      </span>
    );
  }
  if (kind === "created" && (done || current)) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm animate-pop">
        ✓
      </span>
    );
  }
  if (kind === "creating" && current) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-red-950 shadow-sm animate-soft-pulse">
        ◌
      </span>
    );
  }
  if (done) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm animate-pop">
        ✓
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-400 text-xs font-semibold">
      ·
    </span>
  );
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
    <section id="people" className="animate-fade-up rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-red-950">{title}</h2>
          <p className="text-sm text-slate-600">
            {description || `${people.length} people \u00b7 books the exact category each person requested`}
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-800 transition hover:bg-red-50"
          >
            Refresh
          </button>
        ) : null}
      </div>

      {people.length === 0 ? (
        <p className="rounded-xl bg-red-50 px-4 py-6 text-sm text-red-900">{emptyMessage}</p>
      ) : (
        <div className="grid gap-3">
          {people.map((applicant) => {
            const progress = estimateProgress(applicant);
            const category =
              applicant.requestedLicenseCategory || applicant.licenseCategory || "\u2014";
            const isCreatingThis = creatingId === applicant.id;
            const canCreate =
              onCreateOne &&
              progress.key !== "created" &&
              progress.key !== "creating" &&
              !isCreatingThis;

            return (
              <article
                key={applicant.id}
                className="animate-fade-up rounded-xl border border-red-100 bg-gradient-to-r from-white to-red-50/40 p-4 transition hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{applicant.fullName}</p>
                    <p className="text-sm text-slate-600">
                      Category {category}
                      {applicant.phone ? ` \u00b7 ${applicant.phone}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                        progress.key === "created"
                          ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
                          : progress.key === "failed" || progress.key === "paused"
                            ? "bg-red-100 text-red-900 ring-red-200"
                            : progress.key === "creating"
                              ? "bg-amber-50 text-amber-900 ring-amber-200 animate-pulse"
                              : "bg-white text-slate-800 ring-slate-200"
                      }`}
                    >
                      {progress.label}
                    </p>

                    {/* Per-row Create Application button */}
                    {canCreate ? (
                      <button
                        type="button"
                        onClick={() => onCreateOne(applicant)}
                        disabled={isCreatingThis}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        title={`Create application for ${applicant.fullName} (Category ${category})`}
                      >
                        Create Application
                      </button>
                    ) : null}

                    {/* Show spinner while this applicant is being triggered */}
                    {isCreatingThis ? (
                      <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100 animate-pulse">
                        Submitting to Irembo\u2026
                      </span>
                    ) : null}

                    {onEditCategory && editingId !== applicant.id ? (
                      <button
                        type="button"
                        onClick={() => onEditCategory(applicant, null)}
                        className="text-xs font-medium text-red-800 transition hover:text-red-950"
                      >
                        Edit
                      </button>
                    ) : null}
                    {onRetry && (progress.key === "failed" || progress.key === "paused") ? (
                      <button
                        type="button"
                        onClick={() => onRetry(applicant)}
                        className="text-xs font-medium text-red-800 transition hover:text-red-950"
                      >
                        {progress.key === "paused" ? "Resume" : "Retry"}
                      </button>
                    ) : null}
                    {onRemove ? (
                      <button
                        type="button"
                        onClick={() => onRemove(applicant)}
                        className="text-xs text-slate-400 transition hover:text-red-700"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>

                {onEditCategory && editingId === applicant.id ? (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-red-100 bg-white p-3"
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
                        className="mt-1 block rounded-lg border border-red-200 px-2 py-1.5 text-sm text-red-950"
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
                        className="mt-1 block w-40 rounded-lg border border-red-200 px-2 py-1.5 text-sm text-red-950"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      Save and search
                    </button>
                    {onCancelEdit ? (
                      <button
                        type="button"
                        onClick={onCancelEdit}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-800"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </form>
                ) : null}

                {/* 3-Step Flow */}
                <ol className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    { step: 1, kind: "verified", title: "Profile Verified" },
                    {
                      step: 2,
                      kind: progress.key,
                      title:
                        progress.key === "failed"
                          ? "Application rejected"
                          : progress.key === "creating"
                            ? "Submitting to Irembo..."
                            : progress.key === "created"
                              ? "Slot submitted"
                              : "Ready to apply"
                    },
                    { step: 3, kind: "created", title: "Application Code" }
                  ].map((item) => {
                    const done = progress.step > item.step || (item.step === 2 && progress.key === "created");
                    const current = progress.step === item.step;
                    const isFailed = item.step === 2 && progress.key === "failed";
                    return (
                      <li
                        key={item.title}
                        className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition ${
                          isFailed
                            ? "bg-red-50 font-semibold text-red-900 border border-red-200"
                            : current
                              ? "bg-white font-semibold text-slate-900 shadow-sm"
                              : done
                                ? "text-emerald-800"
                                : "text-slate-400"
                        }`}
                      >
                        <StepIcon done={done} current={current} kind={isFailed ? "failed" : item.kind} />
                        <span>{item.title}</span>
                      </li>
                    );
                  })}
                </ol>

                {progress.step === 3 && applicant.applicationNumber ? (
                  <p className="mt-2 font-mono text-sm text-emerald-800 font-semibold">
                    Code: {applicant.applicationNumber}
                  </p>
                ) : null}

                {/* Clear Error Notification Banner */}
                {progress.key === "failed" || progress.key === "paused" ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-none">⚠️</span>
                      <div>
                        <p className="font-semibold text-xs text-red-900 uppercase tracking-wide">
                          {progress.key === "paused" ? "Search Paused" : "Irembo Rejection Message:"}
                        </p>
                        <p className="mt-1 text-xs text-red-800 leading-relaxed font-mono">
                          {progress.detail}
                        </p>
                      </div>
                    </div>
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
