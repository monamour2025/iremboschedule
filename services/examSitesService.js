import { getSystemExamSite } from "../lib/examCenters.js";

export async function getExamSitesForCategory() {
  return {
    sites: [getSystemExamSite()],
    source: "system-lock",
    light: true
  };
}
