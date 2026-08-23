import axios from "axios";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";

const bases = [
  "https://irembo.gov.rw/irembo/rest/public/office",
  "https://irembo.gov.rw/irembo/rest/office",
  "https://irembo.gov.rw/irembo/rest/public/location"
];

const headers = await buildProfileRequestHeaders({});

for (const base of bases) {
  for (const path of ["/office-by-location", "/by-location", "/locations", "/all"]) {
    for (const locationId of ["Musanze", "Nyamagabe"]) {
      for (const officeCode of ["RNP", "POLICE", "TRAFFIC", "DL", "DDL", ""]) {
        const response = await axios.get(`${base}${path}`, {
          headers: {
            ...headers,
            locationId,
            ...(officeCode ? { officeCode } : {})
          },
          validateStatus: () => true,
          timeout: 10000
        });
        if (response.status !== 404 && response.status !== 400) {
          console.log(base + path, locationId, officeCode, response.status, JSON.stringify(response.data)?.slice(0, 400));
        }
      }
    }
  }
}
