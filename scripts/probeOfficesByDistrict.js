import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";

loadEnvFiles();

const headers = await buildProfileRequestHeaders({});
const BASE = "https://irembo.gov.rw/irembo/rest/public";

const districts = (await axios.get(`${BASE}/location/district`, { headers, validateStatus: () => true })).data?.data || [];

for (const district of districts.filter((entry) => ["Musanze", "Nyamagabe", "Gasabo", "Kicukiro"].includes(entry.name))) {
  const response = await axios.get(`${BASE}/office/`, {
    headers: {
      ...headers,
      applicationCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
      locationId: district.guid
    },
    validateStatus: () => true,
    timeout: 15000
  });

  const offices = response.data?.data || [];
  console.log(`\n${district.name} (${district.guid}): ${offices.length} offices`);
  for (const office of offices.slice(0, 5)) {
    console.log(" ", office.code, office.name, office.guid, office.location?.name);
  }
}
