import { requestAcquisitionJobCancellation } from "@/src/db/queries/acquisition_execution";

export async function cancelAcquisitionJobForAdministration(input: {
  clientId: number;
  actorUserId: number;
  jobId: number;
  now: Date;
}) {
  const result = await requestAcquisitionJobCancellation({
    clientId: input.clientId,
    actorUserId: input.actorUserId,
    id: input.jobId,
    now: input.now,
  });
  return result;
}
