import { parseVehicleClasses, primaryVehicleCategory, applicantOwnsCategory, parseIremboDisplayDate } from "../lib/vehicleClassParser.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(parseVehicleClasses("B05062017;").join(",") === "B", "single B category");
assert(parseVehicleClasses("B05062017;C12012020;").join(",") === "B,C", "multiple categories");
assert(parseVehicleClasses("").length === 0, "empty string");
assert(parseVehicleClasses(null).length === 0, "null");
assert(primaryVehicleCategory("B05062017;") === "B", "primary category");
assert(applicantOwnsCategory(["B"], "B") === true, "owns B");
assert(applicantOwnsCategory(["B"], "C") === false, "does not own C");
assert(parseIremboDisplayDate("17/07/2027") instanceof Date, "parses slash date");

console.log("vehicleClassParser checks passed");
