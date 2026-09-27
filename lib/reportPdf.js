"use client";

function formatReportDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.NEXT_PUBLIC_IREMBO_TIMEZONE || "Africa/Kigali",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatAmount(amount) {
  if (amount == null || amount === "") {
    return "-";
  }
  return `${Number(amount).toLocaleString()} RWF`;
}

function mapRowToPdfCells(row) {
  return [
    row.fullName,
    row.phone,
    row.email,
    row.licenseCategory,
    row.preferredLocation,
    row.examCenter,
    row.examSlot,
    row.paymentCode,
    row.status,
    formatAmount(row.amount),
    row.batchName,
    formatReportDate(row.createdAt)
  ];
}

const TABLE_HEAD = [
  [
    "Name",
    "Phone",
    "Email",
    "Cat.",
    "District",
    "Exam center",
    "Exam slot",
    "Kode yo kwishyura",
    "Status",
    "Amount",
    "Batch",
    "Created"
  ]
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-report-pdf="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load PDF library.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.reportPdf = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Could not load PDF library from this app."));
    document.head.appendChild(script);
  });
}

async function createPdfDocument() {
  if (typeof window === "undefined") {
    throw new Error("PDF download is only available in the browser.");
  }

  await loadScript("/vendor/jspdf.umd.min.js");
  await loadScript("/vendor/jspdf.plugin.autotable.min.js");

  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    throw new Error("PDF library failed to load.");
  }
  if (typeof jsPDF.prototype.autoTable !== "function") {
    throw new Error("PDF table plugin failed to load.");
  }

  return new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
}

function addApplicantTable(doc, startY, title, rows, margin) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, margin, startY);

  doc.autoTable({
    startY: startY + 4,
    head: TABLE_HEAD,
    body: rows.map(mapRowToPdfCells),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [185, 28, 28], textColor: 255 },
    alternateRowStyles: { fillColor: [254, 242, 242] },
    margin: { left: margin, right: margin }
  });

  return doc.lastAutoTable.finalY + 8;
}

export async function downloadAutomationReportPdf(report) {
  const doc = await createPdfDocument();
  const margin = 14;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Driving Licence Automation Report", margin, y);

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`Generated: ${formatReportDate(report.generatedAt)}`, margin, y);

  y += 10;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Summary", margin, y);

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const summaryLines = [
    `Total applicants: ${report.summary.totalApplicants}`,
    `Successful applications: ${report.summary.successfulApplications}`,
    `New applicants (${report.windows?.newApplicantDays || 7} days): ${report.summary.newApplicants}`,
    `Recent activity shown: ${report.summary.recentApplicants}`,
    `Payment pending: ${report.summary.paymentPending}`,
    `Completed: ${report.summary.completed}`,
    `Failed: ${report.summary.failed}`,
    `In progress: ${report.summary.inProgress}`
  ];

  for (const line of summaryLines) {
    doc.text(line, margin, y);
    y += 5;
  }

  const categoryText = Object.entries(report.summary.byCategory || {})
    .map(([category, count]) => `Category ${category}: ${count}`)
    .join("   ");

  if (categoryText) {
    y += 2;
    doc.text(categoryText, margin, y);
    y += 6;
  }

  if (report.newApplicants?.length) {
    y = addApplicantTable(
      doc,
      y + 2,
      `New applicants (last ${report.windows?.newApplicantDays || 7} days)`,
      report.newApplicants,
      margin
    );
  }

  if (report.recentApplicants?.length) {
    y = addApplicantTable(
      doc,
      y,
      `Recent applicants (last ${report.windows?.recentApplicantLimit || 30} updates)`,
      report.recentApplicants,
      margin
    );
  }

  if (report.successfulApplicants?.length) {
    addApplicantTable(doc, y, "Successful applications", report.successfulApplicants, margin);
  }

  const stamp = new Date(report.generatedAt).toISOString().slice(0, 10);
  doc.save(`ddl-automation-report-${stamp}.pdf`);
}
