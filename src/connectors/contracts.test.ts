import assert from "node:assert/strict";
import test from "node:test";
import type {
  DeliveryRequest,
  MetricQuery,
  SourceAcquisitionJob,
  SourceAcquisitionReceipt,
} from "./contracts.ts";

test("persisted connector messages use provider-neutral, people-blind fields", () => {
  const job: SourceAcquisitionJob = {
    id: "job-1",
    clientId: "client-1",
    sourceId: "public-forum-source",
    adapterId: "forum-adapter",
    credentialRef: { provider: "secret-store", key: "client-1/forum" },
    dataClassification: "public",
    request: {
      operation: "collect-topic-trends",
      since: "2026-10-01T00:00:00.000Z",
      filters: { market: "DK", topic: ["brand", "category"] },
    },
    idempotencyKey: "client-1:forum:2026-10",
    requestedAt: "2026-10-16T00:00:00.000Z",
  };

  const receipt: SourceAcquisitionReceipt = {
    jobId: job.id,
    status: "succeeded",
    acquiredCount: 42,
    rejectedCount: 3,
    safeArtifactRefs: ["evidence-batch-42"],
    completedAt: "2026-10-16T00:01:00.000Z",
  };

  const serialized = JSON.stringify({ job, receipt });
  for (const forbidden of ["accessToken", "apiKey", "rawPayload", "authorHandle", "userId"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("metric and delivery contracts are scoped by client without naming a provider", () => {
  const metricQuery: MetricQuery = {
    clientId: "client-1",
    sourceId: "commerce-metrics",
    metricKeys: ["conversion_rate"],
    dimensions: ["market"],
    since: "2026-10-01T00:00:00.000Z",
    until: "2026-10-16T00:00:00.000Z",
  };
  const delivery: DeliveryRequest = {
    clientId: "client-1",
    destinationId: "owned-research-library",
    artifactId: "report-12",
    artifactVersion: 2,
    idempotencyKey: "report-12:v2",
  };

  assert.equal(metricQuery.clientId, delivery.clientId);
  assert.equal("provider" in metricQuery, false);
  assert.equal("channelType" in delivery, false);
});
