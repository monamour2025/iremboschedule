import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";

loadEnvFiles();

const headers = await buildProfileRequestHeaders({});
const BASE = "https://irembo.gov.rw/irembo/rest/public";

const probes = [
  ["GET", `${BASE}/police/v2/request/service-price`, { category: "B", location: "Musanze" }],
  ["GET", `${BASE}/police/v2/request/tariff`, { category: "B" }],
  ["GET", `${BASE}/police/v2/request/exam-fee`, { category: "B", location: "Musanze" }],
  ["GET", `${BASE}/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE`, {}],
  ["GET", `${BASE}/service/by-code`, { serviceCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE" }],
  ["GET", `${BASE}/application/service`, { applicationCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE" }],
  ["GET", `${BASE}/application/types`, {}],
  ["GET", `${BASE}/nls/service`, { applicationCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE" }]
];

for (const [method, url, extraHeaders] of probes) {
  const response = await axios({
    method,
    url,
    headers: { ...headers, ...extraHeaders },
    validateStatus: () => true,
    timeout: 12000
  });
  if (response.status !== 404) {
    console.log(method, url.replace(BASE, ""), response.status, JSON.stringify(response.data)?.slice(0, 500));
  }
}

// Try service metadata with header applicationCode on various paths
for (const path of ["/service", "/services", "/citizen-service", "/public-service"]) {
  const response = await axios.get(`${BASE}${path}`, {
    headers: {
      ...headers,
      applicationCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
      serviceCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE"
    },
    validateStatus: () => true,
    timeout: 12000
  });
  if (response.status !== 404) {
    console.log("service path", path, response.status, JSON.stringify(response.data)?.slice(0, 500));
  }
}
