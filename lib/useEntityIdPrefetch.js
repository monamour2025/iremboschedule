"use client";

import { useCallback, useRef } from "react";
import { adminFetch } from "@/lib/adminFetch";
import { isValidNationalIdInput, normalizeNationalIdInput } from "@/lib/nationalId";

export function useEntityIdPrefetch(updateRow) {
  const inflight = useRef(new Map());

  const lookupEntityId = useCallback(
    async (nationalId, fullName, rowKey = "0") => {
      const normalizedId = normalizeNationalIdInput(nationalId);
      if (!isValidNationalIdInput(normalizedId)) {
        return null;
      }

      if (inflight.current.get(rowKey)) {
        return null;
      }

      updateRow(rowKey, {
        entityIdLookupStatus: "loading",
        entityIdLookupError: "Fetching Irembo profile..."
      });

      inflight.current.set(rowKey, true);

      try {
        const payload = await adminFetch("/api/entity-id/lookup", {
          method: "POST",
          timeoutMs: 120000,
          body: JSON.stringify({ nationalId: normalizedId, fullName: String(fullName || "").trim() })
        });

        updateRow(rowKey, {
          entityId: payload.entityId,
          entityIdLookupStatus: "ready",
          entityIdLookupError: "",
          fullName: payload.displayName || fullName
        });
        return payload;
      } catch (error) {
        updateRow(rowKey, {
          entityIdLookupStatus: "error",
          entityIdLookupError: error.message
        });
        throw error;
      } finally {
        inflight.current.delete(rowKey);
      }
    },
    [updateRow]
  );

  return lookupEntityId;
}
