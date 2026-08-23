import { captureIremboResponseCookies, getIremboSessionHeaders } from "../providers/iremboProvider.js";
import { ensureIremboCitizenAuth, getIremboCitizenAuthHeaders, hasIremboCitizenCredentials } from "./iremboCitizenAuth.js";
import { warmIremboSession } from "./iremboSession.js";

const PROFILE_REFERER =
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE";

export async function bootstrapProfileSession(force = false) {
  await warmIremboSession(force);
  if (hasIremboCitizenCredentials()) {
    try {
      await ensureIremboCitizenAuth(force);
    } catch (error) {
      // Anonymous warm session still works for many lookups.
    }
  }
}

export async function buildProfileRequestHeaders(extra = {}) {
  const sessionHeaders = await getIremboSessionHeaders();
  const authHeaders = await getIremboCitizenAuthHeaders();

  return {
    ...sessionHeaders,
    ...authHeaders,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,rw;q=0.8",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest",
    Referer: PROFILE_REFERER,
    Origin: "https://irembo.gov.rw",
    ...extra
  };
}

export { captureIremboResponseCookies };
