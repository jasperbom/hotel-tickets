import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // ── Ontwerptokens ──────────────────────────────────────────────────────
      // Semantische namen maken de verkeerde keuze moeilijker dan de goede:
      // in feature-code hoort geen kale Tailwind-kleur meer voor te komen,
      // alleen ink / paper / urgent / high / done / brand. Heb je een kleur
      // nodig die er niet is, dan is dat een ontwerpvraag.
      fontSize: {
        meta: ["0.875rem", { lineHeight: "1.4" }],    // 14px — ondergrens inhoud
        body: ["1rem", { lineHeight: "1.55" }],       // 16px
        row: ["1.0625rem", { lineHeight: "1.3" }],    // 17px — titels in rijen
      },
      spacing: {
        tap: "2.75rem",   // 44px — minimaal tapdoel
        tapLg: "3rem",    // 48px — primaire actie
      },
      colors: {
        ink: {
          DEFAULT: "#1C1B19",
          70: "#4B4945",
          45: "#6E6B65",
          25: "#A8A49C",
          12: "#DAD6CE",
          6: "#EFEBE3",
        },
        paper: { DEFAULT: "#FBFAF7", raised: "#FFFFFF" },
        urgent: { DEFAULT: "#C0392F", soft: "#FAEAE7" }, // uitsluitend prioriteit urgent
        high: { DEFAULT: "#8F5410", soft: "#FCF3E4" },   // uitsluitend prioriteit hoog
        done: { DEFAULT: "#2F6B46", soft: "#E8F1EB" },   // uitsluitend 'klaar'
        brand: "var(--brand, #2563eb)",                  // uitsluitend interactie
        // Afdelingskleur: identiteit, geen urgentie. Een medewerker herkent
        // "van wie is dit werk" aan de kleur van het plaatje voordat hij het
        // woord leest. Alleen als zacht plaatje met donkere tekst gebruiken —
        // een gevulde rode of amberen rand blijft van prioriteit.
        afd: {
          technical:    { DEFAULT: "#1D5C8F", soft: "#E6EFF6" },
          housekeeping: { DEFAULT: "#7A4E9C", soft: "#F1EAF7" },
          reception:    { DEFAULT: "#1F6F63", soft: "#E4F0EE" },
          service:      { DEFAULT: "#9C5A1E", soft: "#F8EFE3" },
          kitchen:      { DEFAULT: "#A03A57", soft: "#FAE9EE" },
          sales:        { DEFAULT: "#3B5BA5", soft: "#EAEEF8" },
          garden:       { DEFAULT: "#41702A", soft: "#EBF3E5" },
        },
        // Modulekleur voor de navigatie: zwembaden, fietsen en de kennisbot
        // krijgen elk hun eigen accent, zodat de onderbalk niet één grijze rij is.
        mod: {
          zwembaden: "#0E7490",
          fietsen:   "#2F6B46",
          kennis:    "#7A4E9C",
        },
        hotel: {
          50: "#f0f7ff",
          100: "#e0effe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          900: "#1e3a5f",
        },
        // Override the blue palette with CSS variables so the button color
        // can be changed at runtime without rebuilding.
        blue: {
          50:  "var(--blue-50,  #eff6ff)",
          100: "var(--blue-100, #dbeafe)",
          200: "var(--blue-200, #bfdbfe)",
          300: "var(--blue-300, #93c5fd)",
          400: "var(--blue-400, #60a5fa)",
          500: "var(--blue-500, #3b82f6)",
          600: "var(--blue-600, #2563eb)",
          700: "var(--blue-700, #1d4ed8)",
          800: "var(--blue-800, #1e40af)",
          900: "var(--blue-900, #1e3799)",
        },
      },
    },
  },
  plugins: [typography],
};
