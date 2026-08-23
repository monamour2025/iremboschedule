export const APPLICATION_TYPE_FIRST_LICENCE = "FIRST_LICENCE";
export const APPLICATION_TYPE_ADD_CATEGORY = "ADD_CATEGORY";

export function isAddCategoryWorkflow(applicationType) {
  return String(applicationType || APPLICATION_TYPE_FIRST_LICENCE).trim() === APPLICATION_TYPE_ADD_CATEGORY;
}

export function normalizeApplicationType(value) {
  const normalized = String(value || APPLICATION_TYPE_FIRST_LICENCE).trim();
  if (normalized === APPLICATION_TYPE_ADD_CATEGORY) {
    return APPLICATION_TYPE_ADD_CATEGORY;
  }
  return APPLICATION_TYPE_FIRST_LICENCE;
}
