import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";

loadEnvFiles();

const headers = await buildProfileRequestHeaders({});
const BASE = "https://irembo.gov.rw/irembo/rest/public";
const locId = process.argv[2] || "ac2ac588-b25a-4d94-9f18-59bb36640ad0";

const codes = [
  "RNP",
  "POLICE",
  "TRAFFIC",
  "DL",
  "DDL",
  "RNP_TRAFFIC",
  "RNP_DL",
  "RNP_DDL",
  "RNP_HQ",
  "DRIVING_LICENSE",
  "DRIVING_LICENCE",
  "LICENSE",
  "LICENCE",
  "DLT",
  "DL_TEST",
  "PRACTICAL_EXAM",
  "EXAM",
  "TEST",
  "RNP_DDL_REGISTRATION",
  "RNP_POLICE",
  "RNP_OFFICE",
  "RNP_STATION",
  "RNP_DISTRICT",
  "RNP_SECTOR",
  "RNP_CELL",
  "RNP_VILLAGE",
  "RNP_PROVINCE",
  "RNP_REGION",
  "RNP_DIVISION",
  "RNP_UNIT",
  "RNP_BRANCH",
  "RNP_DEPT",
  "RNP_DEPARTMENT",
  "RNP_SERVICE",
  "RNP_CENTER",
  "RNP_CENTRE",
  "RNP_TEST",
  "RNP_EXAM",
  "RNP_PRACTICAL",
  "RNP_THEORY",
  "RNP_DDL_TEST",
  "RNP_DDL_EXAM",
  "RNP_DDL_PRACTICAL",
  "RNP_DDL_THEORY",
  "RNP_DDL_REGISTRATION",
  "RNP_DDL_REGISTRATION_TEST",
  "RNP_DDL_REGISTRATION_EXAM",
  "RNP_DDL_REGISTRATION_PRACTICAL",
  "RNP_DDL_REGISTRATION_THEORY",
  "RNP_DDL_REGISTRATION_DEFINITIVE",
  "RNP_DDL_REGISTRATION_PROVISIONAL",
  "RNP_DDL_REGISTRATION_TEMPORARY",
  "RNP_DDL_REGISTRATION_PERMANENT",
  "RNP_DDL_REGISTRATION_FINAL",
  "RNP_DDL_REGISTRATION_INITIAL",
  "RNP_DDL_REGISTRATION_RENEWAL",
  "RNP_DDL_REGISTRATION_REPLACEMENT",
  "RNP_DDL_REGISTRATION_DUPLICATE",
  "RNP_DDL_REGISTRATION_AMENDMENT",
  "RNP_DDL_REGISTRATION_CANCELLATION",
  "RNP_DDL_REGISTRATION_SUSPENSION",
  "RNP_DDL_REGISTRATION_REVOCATION",
  "RNP_DDL_REGISTRATION_RESTORATION",
  "RNP_DDL_REGISTRATION_REINSTATEMENT",
  "RNP_DDL_REGISTRATION_REVALIDATION",
  "RNP_DDL_REGISTRATION_REISSUE",
  "RNP_DDL_REGISTRATION_REPRINT",
  "RNP_DDL_REGISTRATION_RENEW",
  "RNP_DDL_REGISTRATION_REPLACE",
  "RNP_DDL_REGISTRATION_DUPLICATE",
  "RNP_DDL_REGISTRATION_AMEND",
  "RNP_DDL_REGISTRATION_CANCEL",
  "RNP_DDL_REGISTRATION_SUSPEND",
  "RNP_DDL_REGISTRATION_REVOKE",
  "RNP_DDL_REGISTRATION_RESTORE",
  "RNP_DDL_REGISTRATION_REINSTATE",
  "RNP_DDL_REGISTRATION_REVALIDATE",
  "RNP_DDL_REGISTRATION_REISSUE",
  "RNP_DDL_REGISTRATION_REPRINT",
  "001",
  "002",
  "003",
  "004",
  "005",
  "010",
  "020",
  "030",
  "040",
  "050",
  "100",
  "101",
  "102",
  "103",
  "104",
  "105"
];

for (const officeCode of codes) {
  for (const path of ["/office/by-location-and-code", "/office/by-parent-location-and-code"]) {
    const response = await axios.get(`${BASE}${path}`, {
      headers: { ...headers, locationId: locId, officeCode },
      validateStatus: () => true,
      timeout: 10000
    });
    const data = response.data?.data;
    if (Array.isArray(data) && data.length > 0) {
      console.log("FOUND", path, officeCode, JSON.stringify(data).slice(0, 800));
    } else if (data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length > 0) {
      console.log("FOUND obj", path, officeCode, JSON.stringify(data).slice(0, 800));
    }
  }
}

const appCodeResponse = await axios.get(`${BASE}/office/`, {
  headers: {
    ...headers,
    applicationCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
    locationId: locId
  },
  validateStatus: () => true,
  timeout: 15000
});
console.log("public office list", appCodeResponse.status, JSON.stringify(appCodeResponse.data)?.slice(0, 1200));
