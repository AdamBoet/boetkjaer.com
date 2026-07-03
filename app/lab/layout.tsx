import Sidebar from "../components/Sidebar";
import BottomNav from "../components/BottomNav";
import ThemeToggle from "../components/ThemeToggle";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-4 sm:p-8 pb-24 md:pb-8">{children}</main>
      <BottomNav />
      <ThemeToggle />
    </div>
  );
}
