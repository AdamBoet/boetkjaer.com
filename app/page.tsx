import Link from "next/link";
import Image from "next/image";
import { JetBrains_Mono } from "next/font/google";

const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"] });

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className={`${mono.className} text-[11px] tracking-[0.2em] uppercase text-[#2F6F62] dark:text-[#7FBFAE] mb-4`}>
      {children}
    </p>
  );
}

function DateLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className={`${mono.className} text-[11px] tracking-[0.08em] uppercase text-black/40 dark:text-white/40 mb-1.5`}>
      {children}
    </p>
  );
}

function Expandable({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-start gap-2 select-none">
        <span className="transition-transform duration-150 group-open:rotate-90 inline-block mt-1 text-black/30 dark:text-white/30">
          &rsaquo;
        </span>
        <span className="flex-1">{summary}</span>
      </summary>
      <div className="pt-4 pl-5">{children}</div>
    </details>
  );
}

const socials = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/adam-b%C3%B8tkj%C3%A6r-38562530a",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.86 0-2.15 1.45-2.15 2.94v5.66H9.35V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.11 20.45H3.56V9h3.55v11.45z" />
      </svg>
    ),
  },
  {
    label: "ROAScales",
    href: "https://roascales.com",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 17 9 11 13 15 21 6" />
        <polyline points="14 6 21 6 21 13" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com/adam.boetkjaer",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F5F6F3] dark:bg-[#0F1A19] text-[#14201F] dark:text-[#E9EAE4]">
      <div className="mx-auto max-w-2xl px-6 py-20 sm:py-28 space-y-20">

        {/* Hero */}
        <header>
          <div className="flex items-center gap-5">
            <Image
              src="/adam-headshot.png"
              alt="Adam Bøtkjær"
              width={80}
              height={80}
              className="rounded-full object-cover ring-1 ring-black/10 dark:ring-white/15"
              priority
            />
            <div>
              <h1 className={`${mono.className} text-[clamp(1.5rem,4.5vw,2.1rem)] font-bold tracking-tight`}>
                Adam Bøtkjær
              </h1>
              <p className={`${mono.className} mt-1 text-sm text-black/50 dark:text-white/50`}>
                Co-Founder @ ROAScales &middot; Biotech Student @ DTU
              </p>
            </div>
          </div>

          <p className="mt-6 text-[16px] leading-relaxed text-black/80 dark:text-white/80 max-w-prose">
            Copenhagen-based founder and biotech student &mdash; building growth
            systems at ROAScales, and finishing a bachelor&rsquo;s in biotechnology at DTU.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            {socials.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/15 px-3.5 py-1.5 text-sm hover:border-black/30 dark:hover:border-white/30 transition-colors"
              >
                {s.icon}
                {s.label}
              </a>
            ))}
          </div>
        </header>

        {/* Brief statements */}
        <section className="space-y-8">
          <Eyebrow>Now</Eyebrow>

          <div>
            <DateLabel>Apr 2026 &mdash; Present &middot; Copenhagen</DateLabel>
            <Expandable summary={<span className="text-[16px] font-medium">Co-Founder & CEO, ROAScales &mdash; building growth systems.</span>}>
              <p className="text-[15px] leading-relaxed text-black/75 dark:text-white/75 max-w-prose">
                ROAScales builds growth systems &mdash; the infrastructure and processes
                that let a business scale its acquisition without scaling its chaos.
                I co-founded it to apply the same systems-thinking I use in the lab to
                marketing and growth: find the actual bottleneck, then engineer around it.
              </p>
            </Expandable>
          </div>

          <div>
            <DateLabel>Feb &mdash; Jun 2026 &middot; BRIGHT, DTU</DateLabel>
            <Expandable
              summary={
                <span className="text-[16px] font-medium">
                  Bachelor&rsquo;s thesis &mdash; engineered yeast to grow{" "}
                  <span className={`${mono.className} text-[#C9A227]`}>18&ndash;28% faster</span> on alternative feedstocks.
                </span>
              }
            >
              <div className="space-y-4 text-[15px] leading-relaxed text-black/75 dark:text-white/75 max-w-prose">
                <p>
                  My thesis, in the Yeast Metabolic Engineering group at BRIGHT (Novo
                  Nordisk Foundation Center for Biosustainability, DTU), supervised by
                  Irina Borodina and Yuesheng Zhang, engineered the yeast{" "}
                  <em>Yarrowia lipolytica</em>{" "}
                  &mdash; a candidate for sustainable
                  microbial protein &mdash; to grow better on waste-derived carbon
                  sources (acetate, ethanol, mannitol) instead of conventional sugars.
                  Awarded the top grade.
                </p>
                <p>
                  Using a CRISPR-Cas9 toolkit built in our lab (TUNE
                  <sup className={mono.className}>YALI</sup>), I screened the
                  yeast&rsquo;s regulatory genes for one that would help it process
                  multiple feedstocks at once instead of one at a time. Knocking out a
                  gene called <strong>POR1</strong>{" "}
                  did exactly that &mdash; a
                  reproducible 18&ndash;28% faster growth rate while co-feeding on
                  acetate and ethanol, with no cost to how it handled the third source.
                  A small result on paper, but a genuine lead for more sustainable
                  microbial protein production.
                </p>

                <svg viewBox="0 0 600 210" className="w-full h-auto overflow-visible" aria-hidden>
                  <line x1="20" y1="185" x2="580" y2="185" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
                  <path
                    d="M20,172 C80,169 120,152 150,116 C180,84 205,78 230,82 C280,88 320,66 380,50 C440,40 500,36 580,34"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.28"
                    strokeWidth="2"
                  />
                  <path
                    d="M20,172 C70,167 100,132 130,92 C160,60 182,54 210,58 C260,64 300,46 370,34 C430,25 500,22 580,20"
                    fill="none"
                    stroke="#C9A227"
                    strokeWidth="2.5"
                  />
                  <circle cx="150" cy="116" r="3" fill="currentColor" fillOpacity="0.4" />
                  <circle cx="130" cy="92" r="3.5" fill="#C9A227" />
                  <text x="185" y="102" className={`${mono.className} text-[11px] uppercase tracking-wide`} fill="#C9A227">
                    +18&ndash;28% faster (&mu;max)
                  </text>
                  <text x="20" y="200" className={`${mono.className} text-[10px] uppercase tracking-widest`} fill="currentColor" fillOpacity="0.35">
                    Stage 1 &mdash; acetate / ethanol
                  </text>
                  <text x="440" y="200" className={`${mono.className} text-[10px] uppercase tracking-widest`} fill="currentColor" fillOpacity="0.35">
                    Stage 2 &mdash; mannitol
                  </text>
                </svg>
                <p className={`${mono.className} text-[11px] text-black/35 dark:text-white/35`}>
                  Wild-type (thin) vs. engineered strain (bold).
                </p>
              </div>
            </Expandable>
          </div>
        </section>

        {/* Education */}
        <section>
          <Eyebrow>Education</Eyebrow>

          <div className="space-y-6">
            <div>
              <DateLabel>2026 &mdash; 2028</DateLabel>
              <p className="text-[16px] text-black/80 dark:text-white/80">
                DTU &mdash; MSc, Biotechnology <span className="text-black/40 dark:text-white/40">(in progress)</span>
              </p>
            </div>
            <div>
              <DateLabel>Sep 2025 &mdash; Jan 2026</DateLabel>
              <p className="text-[16px] text-black/80 dark:text-white/80">
                Shanghai Jiao Tong University &mdash; Exchange semester, School of Life
                Sciences &amp; Biotechnology
              </p>
            </div>
            <div>
              <DateLabel>&mdash;</DateLabel>
              <p className="text-[16px] text-black/80 dark:text-white/80">DTU &mdash; BSc, Biotechnology</p>
            </div>
          </div>
        </section>
      </div>

      <Link
        href="/login"
        className="fixed bottom-6 right-6 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors shadow-sm"
      >
        Go to labs
      </Link>
    </div>
  );
}
