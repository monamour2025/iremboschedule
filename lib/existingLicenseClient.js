import { adminFetch } from "./adminFetch.js";

export async function fetchExistingLicenseFromApi({
  nationalId,
  fullName,
  requestedLicenseCategory
}) {
  return adminFetch("/api/applicants/fetch-existing-license", {
    method: "POST",
    timeoutMs: 20000,
    body: JSON.stringify({
      nationalId,
      fullName,
      requestedLicenseCategory: requestedLicenseCategory || undefined
    })
  });
}

export function patchFromExistingLicensePayload(payload) {
  const license = payload.existingLicense || {};
  return {
    fullName: payload.fullName || undefined,
    entityId: payload.entityId || "",
    entityIdLookupStatus: payload.entityId ? "ready" : "idle",
    existingLicenseId: license.id || "",
    existingLicenseFirstName: license.firstName || "",
    existingLicenseLastName: license.lastName || "",
    existingLicenseNumber: license.number || "",
    existingLicenseCategory: license.category || "",
    existingLicenseCategories: license.categories || [],
    existingLicenseVehicleClass: license.vehicleClass || "",
    existingLicenseStatus: license.status || "",
    existingLicenseExpiry: license.expiryDate || "",
    existingLicenseIssueDate: license.issueDate || "",
    existingLicenseDocumentType: license.documentType || "",
    existingLicenseApplicationNumber: license.applicationNumber || "",
    existingLicenseFetchStatus: "ready",
    existingLicenseFetchError: ""
  };
}
