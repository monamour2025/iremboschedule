import { loadEnvFiles } from "../lib/loadEnv.js";
import { lookupEntityIdFromIrembo } from "../services/entityIdService.js";
import { fetchExistingLicenseForNationalId } from "../services/existingLicenseService.js";
import { getCitizenEntityIdByNationalId } from "../providers/iremboApplicationProvider.js";

loadEnvFiles();

const nationalId = process.argv[2] || "1198280186512047";
const fullName = process.argv[3] || "NGAMIJE Gordon";

const nameVariants = [
  fullName,
  "Gordon NGAMIJE",
  "NGAMIJE GORDON"
];

console.log("National ID:", nationalId);
console.log("Primary name:", fullName);

for (const candidate of nameVariants) {
  console.log(`\n--- getCitizenEntityIdByNationalId (${candidate}) ---`);
  try {
    const profile = await getCitizenEntityIdByNationalId(nationalId, { fullName: candidate });
    console.log("OK", profile);
  } catch (error) {
    console.log("ERR", error.message);
  }
}

console.log("\n--- lookupEntityIdFromIrembo ---");
try {
  const result = await lookupEntityIdFromIrembo({ nationalId, fullName });
  console.log("OK", result);
} catch (error) {
  console.log("ERR", error.message);
}

console.log("\n--- fetchExistingLicenseForNationalId ---");
try {
  const result = await fetchExistingLicenseForNationalId({ nationalId, fullName });
  console.log("OK", {
    entityId: result.entityId,
    fullName: result.fullName,
    licenseNumber: result.existingLicense.number
  });
} catch (error) {
  console.log("ERR", error.message);
}
