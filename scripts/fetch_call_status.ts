async function getCallAnalytics(attemptId: string) {
  const org = process.env.SARVAM_ORG_ID;
  const ws = process.env.SARVAM_WORKSPACE_ID;
  const app = process.env.SARVAM_APP_ID;
  const apiKey = process.env.SARVAM_API_KEY;

  const now = new Date();
  const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const startIso = past.toISOString();
  const endIso = now.toISOString();

  const filter = JSON.stringify([
    { id: '1', field: 'attempt_id', operator: 'equals', value: attemptId }
  ]);

  const url = `https://apps.sarvam.ai/api/analytics/v1/${org}/${ws}/${app}/attempts?start_datetime=${encodeURIComponent(startIso)}&end_datetime=${encodeURIComponent(endIso)}&filter_conditions=${encodeURIComponent(filter)}`;

  const res = await fetch(url, { headers: { 'X-API-Key': apiKey! } });
  const data = await res.json() as any;
  console.log('Attempt lookup status:', res.status);
  console.log('Attempt data:', JSON.stringify(data, null, 2));

  if (data?.items?.[0]?.interaction_id) {
    const interactionId = data.items[0].interaction_id;
    const transcriptUrl = `https://apps.sarvam.ai/api/analytics/v1/${org}/${ws}/${app}/transcripts/${interactionId}`;
    const tRes = await fetch(transcriptUrl, { headers: { 'X-API-Key': apiKey! } });
    const tData = await tRes.json();
    console.log('Transcript:', JSON.stringify(tData, null, 2));
  }
}

const attemptId = process.argv[2];
if (!attemptId) {
  console.error('Usage: pnpm tsx scripts/fetch_call_status.ts <attemptId>');
  process.exit(1);
}

getCallAnalytics(attemptId).catch(console.error);
