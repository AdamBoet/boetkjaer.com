import type { Metadata } from "next";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="21 November 2026">
      <p>
        Bøtkjær Labs is a private, personal website run by Adam Bøtkjær for his own use. It is not a commercial service
        and has no other users.
      </p>

      <h2>Bank data</h2>
      <p>
        The Economy section can connect to the owner&apos;s own bank accounts through Enable Banking, a licensed account
        information service provider. The connection is read-only: it can read balances and transactions, and it can
        never make payments or move money.
      </p>
      <ul>
        <li>Only accounts the owner has linked himself, with his own bank login (MitID), are accessed.</li>
        <li>Transactions are stored in a private database used only by this website, behind a login.</li>
        <li>The data is never sold, shared or used for advertising.</li>
        <li>Access to the bank expires automatically after the consent period and can be revoked at any time in the bank or in Enable Banking.</li>
      </ul>

      <h2>Visitors</h2>
      <p>
        The public pages of boetkjaer.com do not use tracking or advertising cookies. The private lab area uses a single
        login cookie.
      </p>
    </LegalPage>
  );
}
