/**
 * Pure adapter fixtures: no provider credential and no production database are
 * touched. A real provider delivery is still required before an account is
 * marked configured in Settings.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  googleAdsAdapter,
  indiamartAdapter,
  justdialAdapter,
  metaLeadAdsAdapter,
} from "../lib/channels/inbound";

async function main() {
  const india = await indiamartAdapter.receive({
    RESPONSE: [{ SENDER_NAME: "Asha Rao", SENDER_MOBILE: "+91 98765 43210", SENDER_EMAIL: "asha@example.com", QUERY_MESSAGE: "Need pricing" }],
  });
  assert.equal(india.length, 1);
  assert.equal(india[0]?.identities.length, 2);
  assert.equal(india[0]?.profile?.firstName, "Asha");

  const justdial = await justdialAdapter.receive({ NAME: "Rohan Mehta", MOBILE: "9876543210", CATEGORY: "Digital marketing" });
  assert.equal(justdial.length, 1);
  assert.equal(justdial[0]?.profile?.firstName, "Rohan");
  assert.equal((await justdialAdapter.receive({ prefix: "Mr", area: "Pune" })).length, 0, "no identifier must not create a lead");

  process.env.META_APP_SECRET = "fixture-meta-secret";
  const raw = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "lead-42" } }] }] });
  const signature = crypto.createHmac("sha256", process.env.META_APP_SECRET).update(raw, "utf8").digest("hex");
  assert.equal(metaLeadAdsAdapter.verify(raw, new Headers({ "x-hub-signature-256": `sha256=${signature}` })), true);
  assert.equal(metaLeadAdsAdapter.verify(raw, new Headers({ "x-hub-signature-256": "sha256=bad" })), false);
  assert.deepEqual(metaLeadAdsAdapter.leadgenIds(JSON.parse(raw)), ["lead-42"]);
  const meta = metaLeadAdsAdapter.fromGraphLead({ id: "lead-42", field_data: [{ name: "email", values: ["asha@example.com"] }] });
  assert.equal(meta?.externalId, "meta:lead-42");
  assert.equal(metaLeadAdsAdapter.fromGraphLead({ id: "no-identifier", field_data: [{ name: "full_name", values: ["Only A Name"] }] }), null);

  process.env.GOOGLE_ADS_WEBHOOK_KEY = "fixture-google-key";
  const googlePayload = {
    google_key: "fixture-google-key",
    lead_id: "google-9",
    user_column_data: [{ column_name: "EMAIL", string_value: "lead@example.com" }, { column_name: "FULL_NAME", string_value: "Nisha Patel" }],
  };
  assert.equal(googleAdsAdapter.verify(googlePayload), true);
  assert.equal(googleAdsAdapter.verify({ ...googlePayload, google_key: "wrong" }), false);
  const googleFirst = await googleAdsAdapter.receive(googlePayload);
  const googleDuplicate = await googleAdsAdapter.receive(googlePayload);
  assert.equal(googleFirst[0]?.externalId, "google_ads:google-9");
  assert.equal(googleDuplicate[0]?.externalId, googleFirst[0]?.externalId, "stable external id enables ingest dedupe");
  assert.equal((await googleAdsAdapter.receive({ google_key: "fixture-google-key", lead_id: "none", user_column_data: [] })).length, 0);

  console.log("Inbound adapter fixtures: 14/14 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
