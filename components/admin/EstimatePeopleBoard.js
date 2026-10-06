"use client";

export function estimateProgress(applicant) {
  const status = String(applicant?.status || "");
  const created = ["APPLICATION_CREATED", "COMPLETED", "PAYMENT_PENDING", "PAID"].includes(status);
  if (created) {
    return {
      step: 3,
      key: "created",
      label: "Application created successfully",
      detail: applicant.applicationNumber || "Code created"
    };
  }
  if (status.startsWith("FAILED")) {
    return {
      step: 2,
      key: "failed",
      label: "Needs attention",
      detail: applicant.lastError || "Booking did not finish"
    };
  }
  if (applicant?.searchPaused) {
    return {
      step: 2,
      key: "paused",
      label: "On hold",
      detail: "Resume search to book this category"
    };
  }
  if (
    status === "RESERVING_SLOT" ||
    status === "SLOT_RESERVED" ||
    status === "LICENSE_VALIDATED" ||
    status === "RUNNING"
  ) {
    return { step: 2, key: "creating", label: "Creating application", detail: "Seats found — submitting to Irembo" };
  }
  if (status === "WAITING_FOR_SLOT" || status === "PENDING" || status === "SAVED") {
    return { step: 2, key: "waiting", label: "Waiting for slot", detail: "Watching Busanza for this category" };
  }
  if (applicant?.entityId) {
    return { step: 1, key: "verified", label: "Verified", detail: "Irembo profile linked" };
  }
  return { step: 1, key: "verified", label: "Verified", detail: "Linking Irembo profile…" };
}

function StepIcon({ done, current, kind }) {
  if (kind === "created" && (done || current)) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white shadow-sm animate-pop">
        ✓
      </span>
    );
  }
  if (kind === "waiting" && current) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-red-950 shadow-sm animate-soft-pulse">
        ◌
      </span>
    );
  }
  if (done || current) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm animate-pop">
        ✓
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-white text-red-300">
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
  editingId,
  onCancelEdit,
  title = "Queue",
  description,
  emptyMessage = "No one in the queue yet. Add people on the Estimate list.",
  categoryOptions = ["A", "A1", "B", "B1", "C", "D", "D1"]
}) {
  const people = Array.isArray(applicants) ? applicants : [];

  return (
    <section id="people" className="animate-fade-up rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-red-950">{title}</h2>
          <p className="text-sm text-slate-600">
            {description || `${people.length} people · books the exact category each person requested`}
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
              applicant.requestedLicenseCategory || applicant.licenseCategory || "—";
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
                      {applicant.phone ? ` · ${applicant.phone}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                        progress.key === "created"
                          ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
                          : progress.key === "failed" || progress.key === "paused"
                            ? "bg-red-100 text-red-900 ring-red-200"
                            : "bg-white text-red-800 ring-red-100"
                      }`}
                    >
                      {progress.label}
                    </p>
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
                      const category = event.currentTarget.category.value;
                      const phone = event.currentTarget.phone.value;
                      onEditCategory(applicant, { category, phone });
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
                <ol className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    { step: 1, kind: "verified", title: "Verified" },
                    { step: 2, kind: "waiting", title: "Waiting for slot" },
                    { step: 3, kind: "created", title: "Application created successfully" }
                  ].map((item) => {
                    const done = progress.step > item.step;
                    const current = progress.step === item.step && progress.key !== "failed" && progress.key !== "paused";
                    return (
                      <li
                        key={item.kind}
                        className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition ${
                          current
                            ? "bg-white font-semibold text-red-900 shadow-sm"
                            : done
                              ? "text-emerald-800"
                              : "text-slate-400"
                        }`}
                      >
                        <StepIcon done={done} current={current} kind={item.kind} />
                        <span>{item.title}</span>
                      </li>
                    );
                  })}
                </ol>
                {progress.step === 3 && applicant.applicationNumber ? (
                  <p className="mt-2 font-mono text-sm text-red-800">{applicant.applicationNumber}</p>
                ) : null}
                {progress.key === "failed" || progress.key === "paused" ? (
                  <p className="mt-2 text-sm text-red-800">{progress.detail}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
