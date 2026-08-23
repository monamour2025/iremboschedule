import {
  isValidNationalIdInput,
  nationalIdValidationMessage,
  normalizeNationalIdInput,
  uniqueNationalIdCandidates
} from "../lib/nationalId.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(normalizeNationalIdInput(" 1198 880196919 ") === "1198880196919", "normalize strips spaces");
assert(isValidNationalIdInput("1198880196919") === true, "13 digit id valid");
assert(isValidNationalIdInput("1198880196919073") === true, "16 digit id valid");
assert(isValidNationalIdInput("11988801969190") === false, "14 digit id invalid");
assert(
  uniqueNationalIdCandidates("1198880196919", "1198880196919073").length === 2,
  "unique candidates"
);
assert(nationalIdValidationMessage("1198880196919") === "", "13 digit message clear");

console.log("nationalId checks passed");
