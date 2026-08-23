import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";

loadEnvFiles();

const headers = await buildProfileRequestHeaders({});
const BASE = "https://irembo.gov.rw/irembo/rest/public";

const paths = [
  "/language",
  "/languages",
  "/nls",
  "/application/language",
  "/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
  "/police/v2/request/nls",
  "/police/v2/request/languages",
  "/police/v2/request/exam-languages"
];

for (const path of paths) {
  const response = await axios.get(`${BASE}${path}`, {
    headers: {
      ...headers,
      applicationCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE"
    },
    validateStatus: () => true,
    timeout: 10000
  });
  if (response.status !== 404) {
    console.log(path, response.status, JSON.stringify(response.data)?.slice(0, 400));
  }
}

for (const path of [
  "/police/v2/request/exam-language",
  "/police/v2/request/exam-languages",
  "/police/v2/request/application-language"
]) {
  const response = await axios.post(`${BASE}${path}`, null, {
    headers: {
      ...headers,
      category: "B",
      location: "Musanze"
    },
    validateStatus: () => true,
    timeout: 10000
  });
  if (response.status !== 404) {
    console.log("POST", path, response.status, JSON.stringify(response.data)?.slice(0, 400));
  }
}
