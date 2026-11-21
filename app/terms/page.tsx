import type { Metadata } from "next";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="21 November 2026">
      <p>
        Bøtkjær Labs (the lab area of boetkjaer.com) is a private application built and used only by its owner, Adam
        Bøtkjær. It is not offered to the public, has no customers and is not a commercial service.
      </p>

      <h2>Use</h2>
      <ul>
        <li>The lab area is protected by a login and is only for the owner&apos;s personal use.</li>
        <li>Bank connections are read-only and limited to the owner&apos;s own linked accounts, via Enable Banking.</li>
        <li>No financial advice, payments or other services are provided to anyone.</li>
      </ul>

      <h2>No warranty</h2>
      <p>The site is provided as is, as a personal project, without any guarantees.</p>

      <p>
        See also the <a href="/privacy" className="underline">privacy page</a>.
      </p>
    </LegalPage>
  );
}
