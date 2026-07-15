import { describe, expect, it } from "vitest";
import { BUNDLE_PERSISTENCE_METHODS, BundlePersistenceError } from "./bundle-persistence.adapter.js";

export function defineBundlePersistenceAdapterContract({ createAdapter, fixture }) {
  describe("BundlePersistenceAdapter contract", () => {
    it("implements every required adapter method", () => {
      const adapter = createAdapter();
      BUNDLE_PERSISTENCE_METHODS.forEach((method) => expect(adapter[method]).toBeTypeOf("function"));
    });

    it("reads and writes definition and revision records", () => {
      const adapter = createAdapter();
      expect(adapter.readBundleDefinition(fixture.definition.bundle_definition_id)).toEqual(fixture.definition);
      expect(adapter.readRevision(fixture.revision.revision_id)).toEqual(fixture.revision);
      expect(adapter.writeBundleDefinition({ definition: fixture.definition })).toEqual(fixture.definition);
      expect(adapter.writeRevision({ revision: fixture.revision })).toEqual(fixture.revision);
    });

    it("enforces Snapshot checksum CAS and restores the previous Snapshot", () => {
      const adapter = createAdapter();
      expect(adapter.writeRuntimeSnapshot(fixture.snapshotWrite)).toEqual(fixture.targetSnapshot);
      expect(() => adapter.writeRuntimeSnapshot({ ...fixture.snapshotWrite, expected_previous_snapshot_checksum: "wrong" }))
        .toThrow(expect.objectContaining({ code: "CHECKSUM_MISMATCH" }));
      expect(adapter.restorePreviousSnapshot(fixture.snapshotRestore)).toEqual(fixture.previousSnapshot);
    });

    it("enforces active revision pointer CAS", () => {
      const adapter = createAdapter();
      expect(adapter.compareAndSetActiveRevision(fixture.pointerCas).active_revision_id)
        .toBe(fixture.pointerCas.target_revision_id);
      expect(() => adapter.compareAndSetActiveRevision(fixture.pointerCas))
        .toThrow(expect.objectContaining({ code: "POINTER_DRIFT" }));
    });

    it("provides idempotent publication lookup and rejects retry conflicts", () => {
      const adapter = createAdapter();
      expect(adapter.writePublicationRecord(fixture.publicationWrite)).toEqual(fixture.publicationWrite.record);
      expect(adapter.readPublicationById(fixture.publicationWrite.publication_id)).toEqual(fixture.publicationWrite.record);
      expect(adapter.writePublicationRecord(fixture.publicationWrite)).toEqual(fixture.publicationWrite.record);
      expect(() => adapter.writePublicationRecord({
        ...fixture.publicationWrite,
        record: { ...fixture.publicationWrite.record, success: false },
      })).toThrow(expect.objectContaining({ code: "RETRY_CONFLICT" }));
    });

    it("normalizes missing records as NOT_FOUND", () => {
      const adapter = createAdapter();
      expect(() => adapter.readRevision("missing")).toThrow(BundlePersistenceError);
      expect(() => adapter.readRevision("missing")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    });
  });
}
