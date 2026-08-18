import Sidebar from "../components/Sidebar";
import MobileNav from "../components/MobileNav";
import { ReviewingProvider } from "../components/ReviewingContext";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <ReviewingProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <MobileNav />
        <main className="flex-1 min-w-0 px-4 sm:px-8 pb-4 sm:pb-8 pt-20 md:pt-8">{children}</main>
      </div>
    </ReviewingProvider>
  );
}
