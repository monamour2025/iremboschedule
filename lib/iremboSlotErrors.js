export function isIremboSlotUnavailableMessage(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("423") ||
    text.includes("3603") ||
    text.includes("100031") ||
    text.includes("locked") ||
    text.includes("no longer available") ||
    text.includes("no live schedule found") ||
    text.includes("no live irembo seats") ||
    text.includes("no open seats") ||
    text.includes("waiting for a matching") ||
    text.includes("bookable") ||
    text.includes("gahunda yibizamini") ||
    text.includes("gahunda yatoranijwe") ||
    text.includes("ntigifite imyanya") ||
    text.includes("imyanya iboneka") ||
    text.includes("ntabwo iri mu gihe kizaza") ||
    text.includes("itariki yagenwe") ||
    text.includes("irimo ikosa") ||
    text.includes("schedule error") ||
    text.includes("trying the next open slot") ||
    text.includes("schedule has an error") ||
    text.includes("all candidate schedules") ||
    text.includes("rejected by irembo")
  );
}

export function isIremboAlreadyRegisteredMessage(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("70011") ||
    text.includes("mwamaze kwiyandikisha") ||
    text.includes("*909#") ||
    text.includes("kode y'ikizamini") ||
    text.includes("kode y ikizamini")
  );
}
